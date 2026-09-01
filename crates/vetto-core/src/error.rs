use thiserror::Error;

#[derive(Error, Debug)]
pub enum VettoError {
    #[error("Landlock error: {0}")]
    Landlock(String),
    #[error("Seccomp error: {0}")]
    Seccomp(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
}
