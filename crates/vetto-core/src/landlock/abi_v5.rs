use crate::error::VettoError;
use std::ffi::c_void;

// --- Linux Landlock System Call Numbers ---
#[cfg(target_arch = "x86_64")]
pub const SYS_LANDLOCK_CREATE_RULESET: i64 = 444;
#[cfg(target_arch = "x86_64")]
pub const SYS_LANDLOCK_ADD_RULE: i64 = 445;
#[cfg(target_arch = "x86_64")]
pub const SYS_LANDLOCK_RESTRICT_SELF: i64 = 446;

#[cfg(target_arch = "aarch64")]
pub const SYS_LANDLOCK_CREATE_RULESET: i64 = 444;
#[cfg(target_arch = "aarch64")]
pub const SYS_LANDLOCK_ADD_RULE: i64 = 445;
#[cfg(target_arch = "aarch64")]
pub const SYS_LANDLOCK_RESTRICT_SELF: i64 = 446;

#[cfg(target_arch = "riscv64")]
pub const SYS_LANDLOCK_CREATE_RULESET: i64 = 444;
#[cfg(target_arch = "riscv64")]
pub const SYS_LANDLOCK_ADD_RULE: i64 = 445;
#[cfg(target_arch = "riscv64")]
pub const SYS_LANDLOCK_RESTRICT_SELF: i64 = 446;

#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_LANDLOCK_CREATE_RULESET: i64 = 444;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_LANDLOCK_ADD_RULE: i64 = 445;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_LANDLOCK_RESTRICT_SELF: i64 = 446;

// --- Landlock Flags & Rule Types ---
pub const LANDLOCK_CREATE_RULESET_VERSION: u32 = 1 << 0;

pub const LANDLOCK_RULE_PATH_BENEATH: u32 = 1;
pub const LANDLOCK_RULE_NET_PORT: u32 = 2;

// --- Filesystem Access Rights (ABI v1) ---
pub const LANDLOCK_ACCESS_FS_EXECUTE: u64 = 1 << 0;
pub const LANDLOCK_ACCESS_FS_WRITE_FILE: u64 = 1 << 1;
pub const LANDLOCK_ACCESS_FS_READ_FILE: u64 = 1 << 2;
pub const LANDLOCK_ACCESS_FS_READ_DIR: u64 = 1 << 3;
pub const LANDLOCK_ACCESS_FS_REMOVE_DIR: u64 = 1 << 4;
pub const LANDLOCK_ACCESS_FS_REMOVE_FILE: u64 = 1 << 5;
pub const LANDLOCK_ACCESS_FS_MAKE_CHAR: u64 = 1 << 6;
pub const LANDLOCK_ACCESS_FS_MAKE_DIR: u64 = 1 << 7;
pub const LANDLOCK_ACCESS_FS_MAKE_REG: u64 = 1 << 8;
pub const LANDLOCK_ACCESS_FS_MAKE_SOCK: u64 = 1 << 9;
pub const LANDLOCK_ACCESS_FS_MAKE_FIFO: u64 = 1 << 10;
pub const LANDLOCK_ACCESS_FS_MAKE_BLOCK: u64 = 1 << 11;
pub const LANDLOCK_ACCESS_FS_MAKE_SYM: u64 = 1 << 12;

// --- Filesystem Access Rights (ABI v2+) ---
pub const LANDLOCK_ACCESS_FS_REFER: u64 = 1 << 13;

// --- Filesystem Access Rights (ABI v3+) ---
pub const LANDLOCK_ACCESS_FS_TRUNCATE: u64 = 1 << 14;

// --- Filesystem Access Rights (ABI v5+) ---
pub const LANDLOCK_ACCESS_FS_IOCTL_DEV: u64 = 1 << 15;

// --- Combined Filesystem Access Masks by ABI ---
pub const LANDLOCK_ACCESS_FS_ABI_V1_MASK: u64 = (1 << 13) - 1;
pub const LANDLOCK_ACCESS_FS_ABI_V2_MASK: u64 = LANDLOCK_ACCESS_FS_ABI_V1_MASK | LANDLOCK_ACCESS_FS_REFER;
pub const LANDLOCK_ACCESS_FS_ABI_V3_MASK: u64 = LANDLOCK_ACCESS_FS_ABI_V2_MASK | LANDLOCK_ACCESS_FS_TRUNCATE;
pub const LANDLOCK_ACCESS_FS_ABI_V4_MASK: u64 = LANDLOCK_ACCESS_FS_ABI_V3_MASK;
pub const LANDLOCK_ACCESS_FS_ABI_V5_MASK: u64 = LANDLOCK_ACCESS_FS_ABI_V4_MASK | LANDLOCK_ACCESS_FS_IOCTL_DEV;

// Convenient composite FS masks
pub const LANDLOCK_ACCESS_FS_READ: u64 =
    LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;

pub const LANDLOCK_ACCESS_FS_WRITE: u64 = LANDLOCK_ACCESS_FS_WRITE_FILE
    | LANDLOCK_ACCESS_FS_REMOVE_DIR
    | LANDLOCK_ACCESS_FS_REMOVE_FILE
    | LANDLOCK_ACCESS_FS_MAKE_CHAR
    | LANDLOCK_ACCESS_FS_MAKE_DIR
    | LANDLOCK_ACCESS_FS_MAKE_REG
    | LANDLOCK_ACCESS_FS_MAKE_SOCK
    | LANDLOCK_ACCESS_FS_MAKE_FIFO
    | LANDLOCK_ACCESS_FS_MAKE_BLOCK
    | LANDLOCK_ACCESS_FS_MAKE_SYM
    | LANDLOCK_ACCESS_FS_REFER
    | LANDLOCK_ACCESS_FS_TRUNCATE
    | LANDLOCK_ACCESS_FS_IOCTL_DEV;

pub const LANDLOCK_ACCESS_FS_ALL: u64 =
    LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ | LANDLOCK_ACCESS_FS_WRITE;

// --- Network Access Rights (ABI v4+) ---
pub const LANDLOCK_ACCESS_NET_BIND_TCP: u64 = 1 << 0;
pub const LANDLOCK_ACCESS_NET_CONNECT_TCP: u64 = 1 << 1;
pub const LANDLOCK_ACCESS_NET_ABI_V4_MASK: u64 =
    LANDLOCK_ACCESS_NET_BIND_TCP | LANDLOCK_ACCESS_NET_CONNECT_TCP;
pub const LANDLOCK_ACCESS_NET_ABI_V5_MASK: u64 = LANDLOCK_ACCESS_NET_ABI_V4_MASK;
pub const LANDLOCK_ACCESS_NET_ALL: u64 = LANDLOCK_ACCESS_NET_ABI_V4_MASK;

// --- Process Scoping Flags (ABI v5+, Linux 6.12+) ---
pub const LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET: u64 = 1 << 0;
pub const LANDLOCK_SCOPE_SIGNAL: u64 = 1 << 1;
pub const LANDLOCK_SCOPE_ABI_V5_MASK: u64 =
    LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET | LANDLOCK_SCOPE_SIGNAL;

/// Kernel structure representing ruleset attributes passed to `landlock_create_ruleset`.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LandlockRulesetAttr {
    /// Bitmask of handled filesystem actions.
    pub handled_access_fs: u64,
    /// Bitmask of handled network actions (ABI v4+).
    pub handled_access_net: u64,
    /// Bitmask of process scoping restrictions (ABI v5+).
    pub scoped: u64,
}

/// Kernel structure representing a path beneath rule passed to `landlock_add_rule`.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LandlockPathBeneathAttr {
    /// Bitmask of allowed filesystem actions for this path.
    pub allowed_access: u64,
    /// File descriptor pointing to the parent directory or file.
    pub parent_fd: i32,
}

/// Kernel structure representing a network port rule passed to `landlock_add_rule`.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LandlockNetPortAttr {
    /// Bitmask of allowed network actions for this port.
    pub allowed_access: u64,
    /// TCP port number (host byte order).
    pub port: u64,
}

/// Returns the maximum Landlock ABI version supported by the running Linux kernel.
/// If Landlock is unsupported or disabled, returns Err(VettoError::LandlockNotSupported).
pub fn landlock_get_abi_version() -> Result<i32, VettoError> {
    #[cfg(target_os = "linux")]
    {
        let version = unsafe {
            libc::syscall(
                SYS_LANDLOCK_CREATE_RULESET,
                std::ptr::null::<LandlockRulesetAttr>(),
                0usize,
                LANDLOCK_CREATE_RULESET_VERSION,
            )
        };
        if version < 0 {
            let err = std::io::Error::last_os_error();
            let errno = err.raw_os_error().unwrap_or(-1);
            if errno == libc::ENOSYS || errno == libc::EOPNOTSUPP {
                return Err(VettoError::LandlockNotSupported(
                    "Landlock is not supported by the kernel".to_string(),
                ));
            }
            return Err(VettoError::syscall_failed(
                errno,
                format!("landlock_create_ruleset(VERSION) failed: {}", err),
            ));
        }
        Ok(version as i32)
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err(VettoError::LandlockNotSupported(
            "Landlock is only available on Linux".to_string(),
        ))
    }
}

/// Invokes `landlock_create_ruleset` syscall with given attribute pointer, size, and flags.
pub unsafe fn sys_landlock_create_ruleset(
    attr: *const LandlockRulesetAttr,
    size: usize,
    flags: u32,
) -> Result<i32, VettoError> {
    #[cfg(target_os = "linux")]
    {
        let fd = libc::syscall(SYS_LANDLOCK_CREATE_RULESET, attr, size, flags);
        if fd < 0 {
            let err = std::io::Error::last_os_error();
            return Err(VettoError::syscall_failed(
                err.raw_os_error().unwrap_or(-1),
                format!("landlock_create_ruleset failed: {}", err),
            ));
        }
        Ok(fd as i32)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (attr, size, flags);
        Err(VettoError::LandlockNotSupported(
            "Landlock is only available on Linux".to_string(),
        ))
    }
}

/// Invokes `landlock_add_rule` syscall to associate a rule with a ruleset fd.
pub unsafe fn sys_landlock_add_rule(
    ruleset_fd: i32,
    rule_type: u32,
    rule_attr: *const c_void,
    flags: u32,
) -> Result<(), VettoError> {
    #[cfg(target_os = "linux")]
    {
        let res = libc::syscall(SYS_LANDLOCK_ADD_RULE, ruleset_fd, rule_type, rule_attr, flags);
        if res < 0 {
            let err = std::io::Error::last_os_error();
            return Err(VettoError::syscall_failed(
                err.raw_os_error().unwrap_or(-1),
                format!("landlock_add_rule failed: {}", err),
            ));
        }
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (ruleset_fd, rule_type, rule_attr, flags);
        Err(VettoError::LandlockNotSupported(
            "Landlock is only available on Linux".to_string(),
        ))
    }
}

/// Invokes `landlock_restrict_self` syscall to enforce the ruleset on current process.
pub unsafe fn sys_landlock_restrict_self(ruleset_fd: i32, flags: u32) -> Result<(), VettoError> {
    #[cfg(target_os = "linux")]
    {
        let res = libc::syscall(SYS_LANDLOCK_RESTRICT_SELF, ruleset_fd, flags);
        if res < 0 {
            let err = std::io::Error::last_os_error();
            return Err(VettoError::syscall_failed(
                err.raw_os_error().unwrap_or(-1),
                format!("landlock_restrict_self failed: {}", err),
            ));
        }
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (ruleset_fd, flags);
        Err(VettoError::LandlockNotSupported(
            "Landlock is only available on Linux".to_string(),
        ))
    }
}

/// Sets the `PR_SET_NO_NEW_PRIVS` flag on the current process via `prctl`.
/// Required before invoking `landlock_restrict_self` or `seccomp` without CAP_SYS_ADMIN.
pub fn prctl_set_no_new_privs() -> Result<(), VettoError> {
    #[cfg(target_os = "linux")]
    {
        let res = unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) };
        if res < 0 {
            let err = std::io::Error::last_os_error();
            return Err(VettoError::syscall_failed(
                err.raw_os_error().unwrap_or(-1),
                format!("prctl(PR_SET_NO_NEW_PRIVS) failed: {}", err),
            ));
        }
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err(VettoError::LandlockNotSupported(
            "PR_SET_NO_NEW_PRIVS is only available on Linux".to_string(),
        ))
    }
}

/// Returns the effective FS access mask supported by the specified Landlock ABI version.
pub fn get_fs_mask_for_abi(abi_version: i32) -> u64 {
    match abi_version {
        v if v >= 5 => LANDLOCK_ACCESS_FS_ABI_V5_MASK,
        4 => LANDLOCK_ACCESS_FS_ABI_V4_MASK,
        3 => LANDLOCK_ACCESS_FS_ABI_V3_MASK,
        2 => LANDLOCK_ACCESS_FS_ABI_V2_MASK,
        1 => LANDLOCK_ACCESS_FS_ABI_V1_MASK,
        _ => 0,
    }
}

/// Returns the effective Net access mask supported by the specified Landlock ABI version.
pub fn get_net_mask_for_abi(abi_version: i32) -> u64 {
    match abi_version {
        v if v >= 4 => LANDLOCK_ACCESS_NET_ABI_V4_MASK,
        _ => 0,
    }
}

/// Returns the effective Scoping mask supported by the specified Landlock ABI version.
pub fn get_scope_mask_for_abi(abi_version: i32) -> u64 {
    match abi_version {
        v if v >= 5 => LANDLOCK_SCOPE_ABI_V5_MASK,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ruleset_attr_layout() {
        assert_eq!(std::mem::size_of::<LandlockRulesetAttr>(), 24);
        assert_eq!(std::mem::align_of::<LandlockRulesetAttr>(), 8);

        let attr = LandlockRulesetAttr {
            handled_access_fs: LANDLOCK_ACCESS_FS_ALL,
            handled_access_net: LANDLOCK_ACCESS_NET_ABI_V4_MASK,
            scoped: LANDLOCK_SCOPE_SIGNAL,
        };
        assert_eq!(attr.handled_access_fs, LANDLOCK_ACCESS_FS_ALL);
        assert_eq!(attr.handled_access_net, 3);
        assert_eq!(attr.scoped, 2);
    }

    #[test]
    fn test_path_beneath_attr_layout() {
        assert_eq!(std::mem::size_of::<LandlockPathBeneathAttr>(), 16);
        let path_rule = LandlockPathBeneathAttr {
            allowed_access: LANDLOCK_ACCESS_FS_READ_FILE,
            parent_fd: 42,
        };
        assert_eq!(path_rule.allowed_access, 4);
        assert_eq!(path_rule.parent_fd, 42);
    }

    #[test]
    fn test_net_port_attr_layout() {
        assert_eq!(std::mem::size_of::<LandlockNetPortAttr>(), 16);
        let net_rule = LandlockNetPortAttr {
            allowed_access: LANDLOCK_ACCESS_NET_BIND_TCP,
            port: 8080,
        };
        assert_eq!(net_rule.allowed_access, 1);
        assert_eq!(net_rule.port, 8080);
    }

    #[test]
    fn test_abi_mask_progression() {
        assert_eq!(get_fs_mask_for_abi(0), 0);
        assert_eq!(get_fs_mask_for_abi(1), 0x1FFF);
        assert_eq!(get_fs_mask_for_abi(2), 0x1FFF | (1 << 13));
        assert_eq!(get_fs_mask_for_abi(3), 0x1FFF | (1 << 13) | (1 << 14));
        assert_eq!(get_fs_mask_for_abi(4), 0x1FFF | (1 << 13) | (1 << 14));
        assert_eq!(
            get_fs_mask_for_abi(5),
            0x1FFF | (1 << 13) | (1 << 14) | (1 << 15)
        );

        assert_eq!(get_net_mask_for_abi(3), 0);
        assert_eq!(get_net_mask_for_abi(4), 3);
        assert_eq!(get_net_mask_for_abi(5), 3);

        assert_eq!(get_scope_mask_for_abi(4), 0);
        assert_eq!(get_scope_mask_for_abi(5), 3);
    }

    #[test]
    fn test_composite_fs_flags() {
        assert_eq!(
            LANDLOCK_ACCESS_FS_READ,
            LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR
        );
        assert!(
            LANDLOCK_ACCESS_FS_ALL & LANDLOCK_ACCESS_FS_EXECUTE != 0
        );
        assert!(
            LANDLOCK_ACCESS_FS_ALL & LANDLOCK_ACCESS_FS_IOCTL_DEV != 0
        );
        assert_eq!(
            LANDLOCK_ACCESS_NET_ALL,
            LANDLOCK_ACCESS_NET_BIND_TCP | LANDLOCK_ACCESS_NET_CONNECT_TCP
        );
    }
}
