use crate::error::VettoError;
use crate::landlock::abi_v5::*;
use std::ffi::{c_void, CString};
use std::path::{Path, PathBuf};

/// Path access rule specifying allowed filesystem operations beneath a hierarchy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathRule {
    pub path: PathBuf,
    pub allowed_access: u64,
}

/// Network port rule specifying allowed TCP operations on a port.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NetPortRule {
    pub port: u16,
    pub allowed_access: u64,
}

/// Builder for constructing and configuring Landlock security rulesets.
#[derive(Debug, Clone)]
pub struct RulesetBuilder {
    handled_access_fs: u64,
    handled_access_net: u64,
    scoped: u64,
    path_rules: Vec<PathRule>,
    net_rules: Vec<NetPortRule>,
    best_effort: bool,
}

impl Default for RulesetBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl RulesetBuilder {
    /// Creates a new RulesetBuilder with full filesystem and network sandboxing defaults.
    pub fn new() -> Self {
        Self {
            handled_access_fs: LANDLOCK_ACCESS_FS_ALL,
            handled_access_net: LANDLOCK_ACCESS_NET_ALL,
            scoped: LANDLOCK_SCOPE_ABI_V5_MASK,
            path_rules: Vec::new(),
            net_rules: Vec::new(),
            best_effort: false,
        }
    }

    /// Sets the filesystem access rights handled by the ruleset.
    pub fn set_handled_fs(&mut self, access: u64) -> &mut Self {
        self.handled_access_fs = access;
        self
    }

    /// Sets the network access rights handled by the ruleset (ABI v4+).
    pub fn set_handled_net(&mut self, access: u64) -> &mut Self {
        self.handled_access_net = access;
        self
    }

    /// Sets the process scoping isolation flags (ABI v5+, signals and abstract unix sockets).
    pub fn set_scoped(&mut self, scope: u64) -> &mut Self {
        self.scoped = scope;
        self
    }

    /// Enables or disables best-effort mode. If true, ruleset creation will downgrade
    /// to supported kernel ABI features instead of failing.
    pub fn best_effort(mut self, enabled: bool) -> Self {
        self.best_effort = enabled;
        self
    }

    /// Registers a path beneath which specified filesystem access rights are granted.
    pub fn allow_path<P: AsRef<Path>>(&mut self, path: P, access: u64) -> Result<&mut Self, VettoError> {
        let p = path.as_ref().to_path_buf();
        if p.as_os_str().is_empty() {
            return Err(VettoError::invalid_rule("path cannot be empty"));
        }
        self.path_rules.push(PathRule {
            path: p,
            allowed_access: access,
        });
        Ok(self)
    }

    /// Helper to grant read-only access beneath a path.
    pub fn allow_read_path<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, VettoError> {
        self.allow_path(path, LANDLOCK_ACCESS_FS_READ | LANDLOCK_ACCESS_FS_EXECUTE)
    }

    /// Helper to grant write-only access beneath a path.
    pub fn allow_write_path<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, VettoError> {
        self.allow_path(path, LANDLOCK_ACCESS_FS_WRITE)
    }

    /// Helper to grant read-write access beneath a path.
    pub fn allow_read_write_path<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, VettoError> {
        self.allow_path(path, LANDLOCK_ACCESS_FS_ALL)
    }

    /// Helper to grant execution access beneath a path.
    pub fn allow_exec_path<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, VettoError> {
        self.allow_path(path, LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ)
    }

    /// Registers a TCP port network access rule.
    pub fn allow_net_port(&mut self, port: u16, access: u64) -> &mut Self {
        self.net_rules.push(NetPortRule {
            port,
            allowed_access: access,
        });
        self
    }

    /// Grants TCP bind permission on specified port.
    pub fn allow_bind_tcp(&mut self, port: u16) -> &mut Self {
        self.allow_net_port(port, LANDLOCK_ACCESS_NET_BIND_TCP)
    }

    /// Grants TCP connect permission on specified port.
    pub fn allow_connect_tcp(&mut self, port: u16) -> &mut Self {
        self.allow_net_port(port, LANDLOCK_ACCESS_NET_CONNECT_TCP)
    }

    /// Probes kernel Landlock support and builds the enforced ruleset.
    pub fn build(&self) -> Result<Ruleset, VettoError> {
        #[cfg(target_os = "linux")]
        {
            let abi_res = landlock_get_abi_version();
            let abi_version = match abi_res {
                Ok(v) => v,
                Err(e) => {
                    if self.best_effort {
                        return Ok(Ruleset {
                            fd: None,
                            abi_version: 0,
                            best_effort: true,
                        });
                    }
                    return Err(e);
                }
            };

            if abi_version <= 0 {
                if self.best_effort {
                    return Ok(Ruleset {
                        fd: None,
                        abi_version: 0,
                        best_effort: true,
                    });
                }
                return Err(VettoError::LandlockNotSupported(
                    "Landlock is reported unsupported by the kernel".to_string(),
                ));
            }

            // Trim handled masks according to kernel ABI level
            let fs_mask = get_fs_mask_for_abi(abi_version);
            let net_mask = get_net_mask_for_abi(abi_version);
            let scope_mask = get_scope_mask_for_abi(abi_version);

            let effective_fs = self.handled_access_fs & fs_mask;
            let effective_net = self.handled_access_net & net_mask;
            let effective_scoped = self.scoped & scope_mask;

            let attr = LandlockRulesetAttr {
                handled_access_fs: effective_fs,
                handled_access_net: effective_net,
                scoped: effective_scoped,
            };

            let ruleset_fd = unsafe {
                sys_landlock_create_ruleset(&attr, std::mem::size_of::<LandlockRulesetAttr>(), 0)?
            };

            // Register path rules
            for rule in &self.path_rules {
                let allowed = rule.allowed_access & effective_fs;
                if allowed == 0 {
                    continue;
                }

                let c_path = match CString::new(rule.path.to_string_lossy().as_bytes()) {
                    Ok(c) => c,
                    Err(_) => {
                        let _ = unsafe { libc::close(ruleset_fd) };
                        return Err(VettoError::InvalidPath(rule.path.clone()));
                    }
                };

                let path_fd = unsafe {
                    libc::open(
                        c_path.as_ptr(),
                        libc::O_PATH | libc::O_CLOEXEC | libc::O_DIRECTORY,
                    )
                };

                // If opening as directory failed, try opening as regular file/object
                let final_path_fd = if path_fd < 0 {
                    unsafe { libc::open(c_path.as_ptr(), libc::O_PATH | libc::O_CLOEXEC) }
                } else {
                    path_fd
                };

                if final_path_fd < 0 {
                    let err = std::io::Error::last_os_error();
                    let _ = unsafe { libc::close(ruleset_fd) };
                    return Err(VettoError::invalid_rule(format!(
                        "failed to open path {:?}: {}",
                        rule.path, err
                    )));
                }

                let path_beneath = LandlockPathBeneathAttr {
                    allowed_access: allowed,
                    parent_fd: final_path_fd,
                };

                let add_res = unsafe {
                    sys_landlock_add_rule(
                        ruleset_fd,
                        LANDLOCK_RULE_PATH_BENEATH,
                        &path_beneath as *const LandlockPathBeneathAttr as *const c_void,
                        0,
                    )
                };

                let _ = unsafe { libc::close(final_path_fd) };

                if let Err(e) = add_res {
                    let _ = unsafe { libc::close(ruleset_fd) };
                    return Err(e);
                }
            }

            // Register net port rules if supported by ABI (v4+)
            if abi_version >= 4 && effective_net != 0 {
                for net_rule in &self.net_rules {
                    let allowed = net_rule.allowed_access & effective_net;
                    if allowed == 0 {
                        continue;
                    }

                    let port_attr = LandlockNetPortAttr {
                        allowed_access: allowed,
                        port: net_rule.port as u64,
                    };

                    let add_res = unsafe {
                        sys_landlock_add_rule(
                            ruleset_fd,
                            LANDLOCK_RULE_NET_PORT,
                            &port_attr as *const LandlockNetPortAttr as *const c_void,
                            0,
                        )
                    };

                    if let Err(e) = add_res {
                        let _ = unsafe { libc::close(ruleset_fd) };
                        return Err(e);
                    }
                }
            }

            Ok(Ruleset {
                fd: Some(ruleset_fd),
                abi_version,
                best_effort: self.best_effort,
            })
        }
        #[cfg(not(target_os = "linux"))]
        {
            if self.best_effort {
                Ok(Ruleset {
                    fd: None,
                    abi_version: 0,
                    best_effort: true,
                })
            } else {
                Err(VettoError::LandlockNotSupported(
                    "Landlock is only available on Linux".to_string(),
                ))
            }
        }
    }
}

/// Active Landlock ruleset ready to be enforced upon the current process and its children.
#[derive(Debug)]
pub struct Ruleset {
    fd: Option<i32>,
    abi_version: i32,
    best_effort: bool,
}

impl Ruleset {
    /// Returns the kernel Landlock ABI version this ruleset was built against.
    pub fn abi_version(&self) -> i32 {
        self.abi_version
    }

    /// Returns the raw Landlock ruleset file descriptor, if allocated.
    pub fn raw_fd(&self) -> Option<i32> {
        self.fd
    }

    /// Enforces the ruleset on the calling process using `landlock_restrict_self`.
    pub fn restrict_self(&self) -> Result<(), VettoError> {
        match self.fd {
            Some(fd) => unsafe { sys_landlock_restrict_self(fd, 0) },
            None => {
                if self.best_effort {
                    Ok(())
                } else {
                    Err(VettoError::LandlockNotSupported(
                        "no active ruleset descriptor to enforce".to_string(),
                    ))
                }
            }
        }
    }

    /// Atomically enables `PR_SET_NO_NEW_PRIVS` and enforces the ruleset on the process.
    pub fn apply(self) -> Result<(), VettoError> {
        if self.fd.is_some() {
            prctl_set_no_new_privs()?;
            self.restrict_self()?;
        } else if !self.best_effort {
            return Err(VettoError::LandlockNotSupported(
                "cannot apply empty ruleset".to_string(),
            ));
        }
        Ok(())
    }
}

impl Drop for Ruleset {
    fn drop(&mut self) {
        #[cfg(target_os = "linux")]
        if let Some(fd) = self.fd.take() {
            unsafe {
                libc::close(fd);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ruleset_builder_defaults() {
        let builder = RulesetBuilder::new();
        assert_eq!(builder.handled_access_fs, LANDLOCK_ACCESS_FS_ALL);
        assert_eq!(builder.handled_access_net, LANDLOCK_ACCESS_NET_ALL);
        assert_eq!(builder.scoped, LANDLOCK_SCOPE_ABI_V5_MASK);
        assert!(!builder.best_effort);
    }

    #[test]
    fn test_ruleset_builder_path_registration() {
        let mut builder = RulesetBuilder::new();
        builder
            .allow_read_path("/usr")
            .expect("allow read path failed")
            .allow_write_path("/tmp")
            .expect("allow write path failed")
            .allow_exec_path("/bin")
            .expect("allow exec path failed");

        assert_eq!(builder.path_rules.len(), 3);
        assert_eq!(builder.path_rules[0].path, PathBuf::from("/usr"));
        assert_eq!(builder.path_rules[1].path, PathBuf::from("/tmp"));
        assert_eq!(builder.path_rules[2].path, PathBuf::from("/bin"));
    }

    #[test]
    fn test_ruleset_builder_empty_path_validation() {
        let mut builder = RulesetBuilder::new();
        let err = builder.allow_path("", LANDLOCK_ACCESS_FS_READ);
        assert!(err.is_err());
        assert!(matches!(err.unwrap_err(), VettoError::InvalidRule(_)));
    }

    #[test]
    fn test_ruleset_builder_net_rules() {
        let mut builder = RulesetBuilder::new();
        builder.allow_bind_tcp(8080).allow_connect_tcp(443);

        assert_eq!(builder.net_rules.len(), 2);
        assert_eq!(builder.net_rules[0].port, 8080);
        assert_eq!(
            builder.net_rules[0].allowed_access,
            LANDLOCK_ACCESS_NET_BIND_TCP
        );
        assert_eq!(builder.net_rules[1].port, 443);
        assert_eq!(
            builder.net_rules[1].allowed_access,
            LANDLOCK_ACCESS_NET_CONNECT_TCP
        );
    }

    #[test]
    fn test_best_effort_build() {
        let builder = RulesetBuilder::new().best_effort(true);
        let ruleset = builder.build();
        assert!(ruleset.is_ok());
    }
}
