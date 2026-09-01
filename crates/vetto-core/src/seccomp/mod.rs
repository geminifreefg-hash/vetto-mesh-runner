pub mod bpf;

pub use bpf::*;

use crate::error::VettoError;

/// Returns true if Seccomp BPF filtering is supported on this kernel.
pub fn is_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        let res = unsafe { libc::prctl(libc::PR_GET_SECCOMP, 0, 0, 0, 0) };
        res >= 0
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Constructs a pre-configured hardened Seccomp filter with high-risk syscalls denied.
pub fn hardened_default_filter() -> Result<SeccompFilter, VettoError> {
    let mut filter = SeccompFilter::default_allow();
    filter.deny_dangerous_syscalls()?;
    Ok(filter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hardened_filter_creation() {
        let filter = hardened_default_filter().expect("failed to create hardened filter");
        let compiled = filter.compile().expect("compilation failed");
        assert!(!compiled.is_empty());
    }
}
