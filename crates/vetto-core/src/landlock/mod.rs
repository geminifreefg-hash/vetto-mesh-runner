pub mod abi_v5;
pub mod ruleset;

pub use abi_v5::*;
pub use ruleset::*;

use crate::error::VettoError;

/// Returns true if the host Linux kernel supports Landlock.
pub fn is_supported() -> bool {
    match landlock_get_abi_version() {
        Ok(v) => v > 0,
        Err(_) => false,
    }
}

/// Returns the detected Landlock ABI version or a descriptive error.
pub fn detect_abi_version() -> Result<i32, VettoError> {
    landlock_get_abi_version()
}

/// Constructs a standard strict sandbox ruleset builder with isolation defaults.
pub fn default_strict_ruleset() -> RulesetBuilder {
    RulesetBuilder::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_landlock_module_helpers() {
        let _builder = default_strict_ruleset();
        let supported = is_supported();
        let version = detect_abi_version();
        if supported {
            assert!(matches!(version, Ok(v) if v > 0));
        }
    }
}
