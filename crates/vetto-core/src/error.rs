use std::path::PathBuf;
use thiserror::Error;

/// Comprehensive error type for all VETTO security sandboxing operations.
#[derive(Error, Debug)]
pub enum VettoError {
    #[error("Landlock error: {0}")]
    Landlock(String),

    #[error("Landlock not supported on this kernel: {0}")]
    LandlockNotSupported(String),

    #[error("Landlock ABI version mismatch: requested v{requested}, kernel supports v{supported}")]
    LandlockAbiMismatch { requested: u32, supported: u32 },

    #[error("Seccomp error: {0}")]
    Seccomp(String),

    #[error("Seccomp not supported on this kernel: {0}")]
    SeccompNotSupported(String),

    #[error("Seccomp BPF compilation error: {0}")]
    BpfCompilationError(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Invalid path: {0}")]
    InvalidPath(PathBuf),

    #[error("Invalid rule configuration: {0}")]
    InvalidRule(String),

    #[error("Process execution failed: {0}")]
    ProcessExecutionFailed(String),

    #[error("Shim cache error: {0}")]
    CacheError(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Syscall failed with errno {errno}: {description}")]
    SyscallFailed { errno: i32, description: String },
}

impl VettoError {
    /// Helper to construct a Landlock error.
    pub fn landlock<S: Into<String>>(msg: S) -> Self {
        VettoError::Landlock(msg.into())
    }

    /// Helper to construct a Seccomp error.
    pub fn seccomp<S: Into<String>>(msg: S) -> Self {
        VettoError::Seccomp(msg.into())
    }

    /// Helper to construct an invalid rule error.
    pub fn invalid_rule<S: Into<String>>(msg: S) -> Self {
        VettoError::InvalidRule(msg.into())
    }

    /// Helper to construct a cache error.
    pub fn cache<S: Into<String>>(msg: S) -> Self {
        VettoError::CacheError(msg.into())
    }

    /// Helper to construct a syscall failure error.
    pub fn syscall_failed<S: Into<String>>(errno: i32, description: S) -> Self {
        VettoError::SyscallFailed {
            errno,
            description: description.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error as IoError, ErrorKind};

    #[test]
    fn test_error_display_formatting() {
        let err = VettoError::landlock("ruleset creation failed");
        assert_eq!(err.to_string(), "Landlock error: ruleset creation failed");

        let err = VettoError::seccomp("filter load failed");
        assert_eq!(err.to_string(), "Seccomp error: filter load failed");

        let err = VettoError::LandlockAbiMismatch {
            requested: 5,
            supported: 3,
        };
        assert_eq!(
            err.to_string(),
            "Landlock ABI version mismatch: requested v5, kernel supports v3"
        );

        let err = VettoError::syscall_failed(13, "EACCES on ruleset");
        assert_eq!(
            err.to_string(),
            "Syscall failed with errno 13: EACCES on ruleset"
        );
    }

    #[test]
    fn test_io_error_conversion() {
        let io_err = IoError::new(ErrorKind::NotFound, "file not found");
        let vetto_err: VettoError = io_err.into();
        assert!(matches!(vetto_err, VettoError::Io(ref e) if e.kind() == ErrorKind::NotFound));
    }

    #[test]
    fn test_helper_constructors() {
        let err_rule = VettoError::invalid_rule("empty path");
        assert!(matches!(err_rule, VettoError::InvalidRule(_)));

        let err_cache = VettoError::cache("corrupted hash entry");
        assert!(matches!(err_cache, VettoError::CacheError(_)));

        let err_path = VettoError::InvalidPath(PathBuf::from("/nonexistent/test"));
        assert!(err_path.to_string().contains("/nonexistent/test"));
    }
}
