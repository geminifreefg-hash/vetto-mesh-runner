pub mod error;
pub mod landlock;
pub mod seccomp;

pub use error::VettoError;
pub use landlock::{Ruleset, RulesetBuilder};
pub use seccomp::{BpfProgram, SeccompAction, SeccompFilter};

use std::path::Path;

/// High-level integrated sandbox orchestrator combining Landlock and Seccomp BPF.
#[derive(Debug, Clone)]
pub struct VettoSandbox {
    landlock_builder: RulesetBuilder,
    seccomp_filter: SeccompFilter,
    enable_seccomp: bool,
    best_effort: bool,
}

impl Default for VettoSandbox {
    fn default() -> Self {
        Self::new()
    }
}

impl VettoSandbox {
    /// Creates a new integrated sandbox with hardened Landlock and Seccomp security defaults.
    pub fn new() -> Self {
        let mut filter = SeccompFilter::default_allow();
        let _ = filter.deny_dangerous_syscalls();

        Self {
            landlock_builder: RulesetBuilder::new(),
            seccomp_filter: filter,
            enable_seccomp: true,
            best_effort: false,
        }
    }

    /// Sets best effort mode for environments with older or restricted kernels.
    pub fn best_effort(mut self, enabled: bool) -> Self {
        self.best_effort = enabled;
        self.landlock_builder = self.landlock_builder.best_effort(enabled);
        self
    }

    /// Grants read-only access to a filesystem hierarchy.
    pub fn allow_read<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, VettoError> {
        self.landlock_builder.allow_read_path(path)?;
        Ok(self)
    }

    /// Grants write access to a filesystem hierarchy.
    pub fn allow_write<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, VettoError> {
        self.landlock_builder.allow_write_path(path)?;
        Ok(self)
    }

    /// Grants execution access to a filesystem hierarchy.
    pub fn allow_exec<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, VettoError> {
        self.landlock_builder.allow_exec_path(path)?;
        Ok(self)
    }

    /// Grants network TCP port access.
    pub fn allow_port(&mut self, port: u16) -> &mut Self {
        self.landlock_builder.allow_bind_tcp(port);
        self.landlock_builder.allow_connect_tcp(port);
        self
    }

    /// Denies a specific system call via Seccomp BPF filter.
    pub fn deny_syscall(&mut self, nr: i32) -> Result<&mut Self, VettoError> {
        self.seccomp_filter
            .deny_syscall(nr, SeccompAction::Errno(libc::EPERM as u16))?;
        Ok(self)
    }

    /// Enforces both Landlock ruleset and Seccomp BPF filters on the calling process.
    pub fn apply(&self) -> Result<(), VettoError> {
        // 1. Build and apply Landlock ruleset
        let ruleset = self.landlock_builder.build()?;
        ruleset.apply()?;

        // 2. Compile and apply Seccomp BPF filter
        if self.enable_seccomp {
            let bpf = self.seccomp_filter.compile()?;
            if let Err(e) = bpf.apply() {
                if !self.best_effort {
                    return Err(e);
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vetto_sandbox_builder() {
        let mut sandbox = VettoSandbox::new();
        sandbox.best_effort(true);
        sandbox.allow_read("/usr").expect("allow read failed");
        sandbox.allow_write("/tmp").expect("allow write failed");
        sandbox.allow_port(443);
        sandbox.deny_syscall(101).expect("deny syscall failed");

        assert!(sandbox.best_effort);
    }
}
