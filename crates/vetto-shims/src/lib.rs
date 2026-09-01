pub mod cache;
pub mod interceptor;

pub use cache::{CacheEntry, Sha256, ShimCache};
pub use interceptor::ShimInterceptor;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shim_exports() {
        let _interceptor = ShimInterceptor::new("curl");
        let hash = Sha256::digest_hex(b"test");
        assert_eq!(hash.len(), 64);
    }
}
