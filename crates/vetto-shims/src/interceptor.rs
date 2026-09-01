use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus};
use vetto_core::{VettoError, VettoSandbox};

pub const ENV_VETTO_WRAPPED: &str = "VETTO_WRAPPED";
pub const ENV_VETTO_SHIM_ACTIVE: &str = "VETTO_SHIM_ACTIVE";
pub const ENV_VETTO_ORIGINAL_PATH: &str = "VETTO_ORIGINAL_PATH";

/// Helper to detect if a filesystem path is a VETTO shim directory.
fn is_shim_directory(dir: &Path) -> bool {
    let s = dir.to_string_lossy();
    if s.ends_with("/.vetto/shims")
        || s.ends_with("/.vetto/shims/")
        || s.contains("/.vetto/shims/")
        || s.ends_with("/shims")
        || s.ends_with("/shims/")
        || s == ".vetto/shims"
        || s == "shims"
    {
        return true;
    }

    if let Some(custom) = env::var_os("VETTO_SHIM_DIR") {
        let custom_path = Path::new(&custom);
        if dir == custom_path || dir.starts_with(custom_path) {
            return true;
        }
    }

    if let Some(home) = env::var_os("HOME") {
        let default_shim = PathBuf::from(home).join(".vetto").join("shims");
        if dir == default_shim || dir.starts_with(&default_shim) {
            return true;
        }
    }

    false
}

/// PATH-shim transparent process interceptor and security sandbox enforcer.
#[derive(Debug, Clone)]
pub struct ShimInterceptor {
    pub target_binary: String,
    pub allowed_read_paths: Vec<PathBuf>,
    pub allowed_write_paths: Vec<PathBuf>,
    pub allowed_exec_paths: Vec<PathBuf>,
    pub allowed_ports: Vec<u16>,
    pub enable_seccomp: bool,
    pub custom_env: HashMap<String, String>,
    pub inherit_env: bool,
    pub best_effort: bool,
}

impl ShimInterceptor {
    /// Creates a new ShimInterceptor for the given executable name (e.g. "git", "node", "curl").
    pub fn new(target_binary: &str) -> Self {
        Self {
            target_binary: target_binary.to_string(),
            allowed_read_paths: Vec::new(),
            allowed_write_paths: Vec::new(),
            allowed_exec_paths: Vec::new(),
            allowed_ports: Vec::new(),
            enable_seccomp: true,
            custom_env: HashMap::new(),
            inherit_env: true,
            best_effort: false,
        }
    }

    /// Grants read-only access to a filesystem path.
    pub fn allow_read_path<P: AsRef<Path>>(&mut self, path: P) -> &mut Self {
        self.allowed_read_paths.push(path.as_ref().to_path_buf());
        self
    }

    /// Grants write access to a filesystem path.
    pub fn allow_write_path<P: AsRef<Path>>(&mut self, path: P) -> &mut Self {
        self.allowed_write_paths.push(path.as_ref().to_path_buf());
        self
    }

    /// Grants execution access to a filesystem path.
    pub fn allow_exec_path<P: AsRef<Path>>(&mut self, path: P) -> &mut Self {
        self.allowed_exec_paths.push(path.as_ref().to_path_buf());
        self
    }

    /// Grants network TCP port access for sandboxed child execution.
    pub fn allow_port(&mut self, port: u16) -> &mut Self {
        self.allowed_ports.push(port);
        self
    }

    /// Enables or disables Seccomp BPF syscall filtering.
    pub fn with_seccomp(&mut self, enable: bool) -> &mut Self {
        self.enable_seccomp = enable;
        self
    }

    /// Sets a custom environment variable for the wrapped process.
    pub fn set_env<K: Into<String>, V: Into<String>>(&mut self, key: K, val: V) -> &mut Self {
        self.custom_env.insert(key.into(), val.into());
        self
    }

    /// Configures environment inheritance from current process.
    pub fn inherit_env(&mut self, inherit: bool) -> &mut Self {
        self.inherit_env = inherit;
        self
    }

    /// Enables best-effort mode for unprivileged or older kernels.
    pub fn best_effort(mut self, enabled: bool) -> Self {
        self.best_effort = enabled;
        self
    }

    /// Returns true if the current execution is already inside a VETTO wrapped child.
    pub fn is_recursion_active() -> bool {
        env::var(ENV_VETTO_WRAPPED).map(|v| v == "1").unwrap_or(false)
            || env::var(ENV_VETTO_SHIM_ACTIVE).map(|v| v == "1").unwrap_or(false)
    }

    /// Resolves the underlying real binary executable by searching system PATH,
    /// explicitly excluding shim directories and the current shim executable to prevent infinite self-invocation.
    pub fn find_underlying_binary(
        &self,
        current_shim_path: Option<&Path>,
    ) -> Result<PathBuf, VettoError> {
        let path_var = env::var_os(ENV_VETTO_ORIGINAL_PATH)
            .unwrap_or_else(|| env::var_os("PATH").unwrap_or_default());
        let paths = env::split_paths(&path_var);

        let current_canonical = current_shim_path.and_then(|p| fs::canonicalize(p).ok());

        for dir in paths {
            if is_shim_directory(&dir) {
                continue;
            }

            let candidate = dir.join(&self.target_binary);
            if candidate.is_file() {
                // Check if candidate is executable
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(meta) = candidate.metadata() {
                        if meta.permissions().mode() & 0o111 == 0 {
                            continue;
                        }
                    }
                }

                // If candidate is identical to our current running shim or inside a shim dir, skip it
                if let Ok(cand_canonical) = fs::canonicalize(&candidate) {
                    if let Some(ref current) = current_canonical {
                        if &cand_canonical == current {
                            continue;
                        }
                    }
                    if let Some(parent) = cand_canonical.parent() {
                        if is_shim_directory(parent) {
                            continue;
                        }
                    }
                }

                return Ok(candidate);
            }
        }

        Err(VettoError::InvalidPath(PathBuf::from(&self.target_binary)))
    }

    /// Sanitizes environment variables: strips dangerous variables and injects VETTO barrier markers.
    pub fn sanitize_environment(&self) -> HashMap<String, String> {
        let mut clean_env = HashMap::new();

        if self.inherit_env {
            for (k, v) in env::vars() {
                // Strip dangerous dynamic linker injection variables
                if k == "LD_PRELOAD"
                    || k == "LD_AUDIT"
                    || k == "DYLD_INSERT_LIBRARIES"
                    || k == "DYLD_LIBRARY_PATH"
                {
                    continue;
                }
                clean_env.insert(k, v);
            }
        }

        // Apply custom overrides
        for (k, v) in &self.custom_env {
            clean_env.insert(k.clone(), v.clone());
        }

        // Inject recursion barrier flags
        clean_env.insert(ENV_VETTO_WRAPPED.to_string(), "1".to_string());
        clean_env.insert(ENV_VETTO_SHIM_ACTIVE.to_string(), "1".to_string());

        clean_env
    }

    /// Spawns and executes the underlying binary with sandbox restrictions applied in the child process.
    pub fn wrap_execution(&self, args: &[String]) -> Result<ExitStatus, VettoError> {
        let current_exe = env::current_exe().ok();
        let target_path = self.find_underlying_binary(current_exe.as_deref())?;

        let mut cmd = Command::new(&target_path);
        cmd.args(args);

        let sanitized = self.sanitize_environment();
        cmd.env_clear();
        for (k, v) in sanitized {
            cmd.env(k, v);
        }

        // Prepare child process sandbox hooks if recursion barrier is not active
        if !Self::is_recursion_active() {
            let mut sandbox = VettoSandbox::new();
            sandbox = sandbox.best_effort(self.best_effort);

            // Allow read paths (and system libraries)
            for path in &self.allowed_read_paths {
                let _ = sandbox.allow_read(path);
            }

            // Allow write paths
            for path in &self.allowed_write_paths {
                let _ = sandbox.allow_write(path);
            }

            // Allow exec paths
            for path in &self.allowed_exec_paths {
                let _ = sandbox.allow_exec(path);
            }

            // Allow network ports
            for &port in &self.allowed_ports {
                sandbox.allow_port(port);
            }

            #[cfg(target_os = "linux")]
            {
                use std::os::unix::process::CommandExt;
                unsafe {
                    cmd.pre_exec(move || {
                        sandbox
                            .apply()
                            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
                    });
                }
            }
        }

        let mut child = cmd.spawn().map_err(|e| {
            VettoError::ProcessExecutionFailed(format!(
                "failed to spawn target binary {:?}: {}",
                target_path, e
            ))
        })?;

        let status = child.wait().map_err(|e| {
            VettoError::ProcessExecutionFailed(format!("failed waiting for child process: {}", e))
        })?;

        Ok(status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interceptor_builder() {
        let mut interceptor = ShimInterceptor::new("ls");
        interceptor
            .allow_read_path("/usr/lib")
            .allow_write_path("/tmp")
            .allow_port(8080)
            .set_env("CUSTOM_VAR", "123")
            .with_seccomp(true);

        assert_eq!(interceptor.target_binary, "ls");
        assert_eq!(interceptor.allowed_read_paths.len(), 1);
        assert_eq!(interceptor.allowed_write_paths.len(), 1);
        assert_eq!(interceptor.allowed_ports, vec![8080]);
        assert_eq!(
            interceptor.custom_env.get("CUSTOM_VAR"),
            Some(&"123".to_string())
        );
    }

    #[test]
    fn test_environment_sanitization() {
        let mut interceptor = ShimInterceptor::new("cat");
        interceptor.set_env("SAFE_KEY", "safe_val");

        let env_map = interceptor.sanitize_environment();
        assert_eq!(env_map.get(ENV_VETTO_WRAPPED), Some(&"1".to_string()));
        assert_eq!(env_map.get(ENV_VETTO_SHIM_ACTIVE), Some(&"1".to_string()));
        assert_eq!(env_map.get("SAFE_KEY"), Some(&"safe_val".to_string()));
        assert!(!env_map.contains_key("LD_PRELOAD"));
    }

    #[test]
    fn test_is_shim_directory_detection() {
        assert!(is_shim_directory(Path::new("/home/user/.vetto/shims")));
        assert!(is_shim_directory(Path::new("/home/user/.vetto/shims/")));
        assert!(is_shim_directory(Path::new("/opt/shims")));
        assert!(!is_shim_directory(Path::new("/usr/bin")));
        assert!(!is_shim_directory(Path::new("/bin")));
    }

    #[test]
    fn test_find_binary_not_found() {
        let interceptor = ShimInterceptor::new("nonexistent_binary_xyz_123");
        let res = interceptor.find_underlying_binary(None);
        assert!(res.is_err());
        assert!(matches!(res.unwrap_err(), VettoError::InvalidPath(_)));
    }
}
