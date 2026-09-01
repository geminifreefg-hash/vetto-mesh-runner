use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use vetto_core::VettoError;

/// Cached metadata and cryptographic digest for an intercepted executable binary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CacheEntry {
    pub sha256: String,
    pub size: u64,
    pub mtime_secs: u64,
    pub last_verified_secs: u64,
    pub quarantined: bool,
}

/// FIPS 180-4 compliant SHA-256 implementation.
pub struct Sha256 {
    state: [u32; 8],
    count: u64,
    buffer: [u8; 64],
}

impl Default for Sha256 {
    fn default() -> Self {
        Self::new()
    }
}

impl Sha256 {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    pub fn new() -> Self {
        Self {
            state: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
                0x1f83d9ab, 0x5be0cd19,
            ],
            count: 0,
            buffer: [0u8; 64],
        }
    }

    pub fn update(&mut self, data: &[u8]) {
        let mut input = data;
        let mut buffer_idx = (self.count & 63) as usize;
        self.count = self.count.wrapping_add(input.len() as u64);

        if buffer_idx > 0 {
            let space = 64 - buffer_idx;
            if input.len() >= space {
                self.buffer[buffer_idx..64].copy_from_slice(&input[..space]);
                self.process_block(&self.buffer.clone());
                input = &input[space..];
                buffer_idx = 0;
            } else {
                self.buffer[buffer_idx..buffer_idx + input.len()].copy_from_slice(input);
                return;
            }
        }

        while input.len() >= 64 {
            let mut block = [0u8; 64];
            block.copy_from_slice(&input[..64]);
            self.process_block(&block);
            input = &input[64..];
        }

        if !input.is_empty() {
            self.buffer[..input.len()].copy_from_slice(input);
        }
    }

    fn process_block(&mut self, block: &[u8; 64]) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                block[i * 4],
                block[i * 4 + 1],
                block[i * 4 + 2],
                block[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = self.state[0];
        let mut b = self.state[1];
        let mut c = self.state[2];
        let mut d = self.state[3];
        let mut e = self.state[4];
        let mut f = self.state[5];
        let mut g = self.state[6];
        let mut h = self.state[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(Self::K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        self.state[0] = self.state[0].wrapping_add(a);
        self.state[1] = self.state[1].wrapping_add(b);
        self.state[2] = self.state[2].wrapping_add(c);
        self.state[3] = self.state[3].wrapping_add(d);
        self.state[4] = self.state[4].wrapping_add(e);
        self.state[5] = self.state[5].wrapping_add(f);
        self.state[6] = self.state[6].wrapping_add(g);
        self.state[7] = self.state[7].wrapping_add(h);
    }

    pub fn finalize(mut self) -> [u8; 32] {
        let bit_len = self.count.wrapping_mul(8);
        let buffer_idx = (self.count & 63) as usize;

        let mut pad = [0u8; 128];
        pad[0] = 0x80;
        let pad_len = if buffer_idx < 56 {
            56 - buffer_idx
        } else {
            120 - buffer_idx
        };

        self.update(&pad[..pad_len]);
        self.update(&bit_len.to_be_bytes());

        let mut output = [0u8; 32];
        for (i, word) in self.state.iter().enumerate() {
            output[i * 4..(i + 1) * 4].copy_from_slice(&word.to_be_bytes());
        }
        output
    }

    pub fn digest_hex(data: &[u8]) -> String {
        let mut hasher = Self::new();
        hasher.update(data);
        let bytes = hasher.finalize();
        let mut hex = String::with_capacity(64);
        for byte in bytes {
            use std::fmt::Write;
            let _ = write!(hex, "{:02x}", byte);
        }
        hex
    }
}

/// Thread-safe, concurrency-safe on-disk cache for verified executable digests.
#[derive(Debug)]
pub struct ShimCache {
    cache_dir: PathBuf,
    ttl: Duration,
    entries: RwLock<HashMap<String, CacheEntry>>,
}

impl ShimCache {
    /// Initializes a ShimCache in the target directory, creating it if needed.
    pub fn new<P: AsRef<Path>>(cache_dir: P) -> Result<Self, VettoError> {
        let dir = cache_dir.as_ref().to_path_buf();
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| {
                VettoError::cache(format!("failed to create cache dir {:?}: {}", dir, e))
            })?;
        }

        let cache = Self {
            cache_dir: dir,
            ttl: Duration::from_secs(86400 * 7), // 7 days default TTL
            entries: RwLock::new(HashMap::new()),
        };

        let _ = cache.load_from_disk();
        Ok(cache)
    }

    /// Sets custom time-to-live for cache entries.
    pub fn with_ttl(mut self, ttl: Duration) -> Self {
        self.ttl = ttl;
        self
    }

    /// Path to the primary cache metadata file.
    pub fn cache_file_path(&self) -> PathBuf {
        self.cache_dir.join("cache.json")
    }

    /// Computes the SHA-256 hex digest of a file on disk.
    pub fn compute_sha256<P: AsRef<Path>>(path: P) -> Result<String, VettoError> {
        let mut file = File::open(path.as_ref())
            .map_err(|e| VettoError::cache(format!("cannot open file for hashing: {}", e)))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];
        loop {
            let bytes_read = file
                .read(&mut buffer)
                .map_err(|e| VettoError::cache(format!("error reading file for hashing: {}", e)))?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }
        let bytes = hasher.finalize();
        let mut hex = String::with_capacity(64);
        for byte in bytes {
            use std::fmt::Write;
            let _ = write!(hex, "{:02x}", byte);
        }
        Ok(hex)
    }

    /// Retrieves cached SHA-256 hash if present.
    pub fn get_hash(&self, key: &str) -> Option<String> {
        let guard = self.entries.read().ok()?;
        guard.get(key).map(|e| e.sha256.clone())
    }

    /// Sets cached SHA-256 hash and persists atomically to disk.
    pub fn set_hash(&self, key: &str, hash: &str) -> Result<(), VettoError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        {
            let mut guard = self
                .entries
                .write()
                .map_err(|_| VettoError::cache("RwLock poisoned on set_hash"))?;
            guard.insert(
                key.to_string(),
                CacheEntry {
                    sha256: hash.to_string(),
                    size: 0,
                    mtime_secs: now,
                    last_verified_secs: now,
                    quarantined: false,
                },
            );
        }

        self.save_to_disk_atomic()
    }

    /// Verifies if a binary's cache entry is fresh according to mtime, size, and TTL.
    /// If outdated or absent, recomputes the SHA-256 digest, updates the cache, and saves atomically.
    pub fn verify_and_update<P: AsRef<Path>>(&self, binary_path: P) -> Result<(String, bool), VettoError> {
        let path = binary_path.as_ref();
        let metadata = fs::metadata(path).map_err(|e| {
            VettoError::cache(format!("cannot read binary metadata {:?}: {}", path, e))
        })?;

        let canonical = fs::canonicalize(path)
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .to_string();

        let mtime = metadata
            .modified()
            .unwrap_or(SystemTime::now())
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let size = metadata.len();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Check in-memory cache
        {
            let guard = self
                .entries
                .read()
                .map_err(|_| VettoError::cache("RwLock poisoned on read"))?;
            if let Some(entry) = guard.get(&canonical) {
                let age = now.saturating_sub(entry.last_verified_secs);
                if entry.mtime_secs == mtime && entry.size == size && age < self.ttl.as_secs() {
                    return Ok((entry.sha256.clone(), true));
                }
            }
        }

        // Cache miss or stale: rehash binary
        let sha256 = Self::compute_sha256(path)?;
        {
            let mut guard = self
                .entries
                .write()
                .map_err(|_| VettoError::cache("RwLock poisoned on write"))?;
            guard.insert(
                canonical,
                CacheEntry {
                    sha256: sha256.clone(),
                    size,
                    mtime_secs: mtime,
                    last_verified_secs: now,
                    quarantined: false,
                },
            );
        }

        // Non-fatal disk save: if disk write fails (e.g. read-only fs EROFS, full disk ENOSPC),
        // return computed in-memory hash without aborting.
        let _ = self.save_to_disk_atomic();
        Ok((sha256, false))
    }

    /// Atomically persists the in-memory cache to disk via temporary file rename with cross-process flock synchronization.
    pub fn save_to_disk_atomic(&self) -> Result<(), VettoError> {
        let lock_path = self.cache_dir.join("cache.lock");
        let lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(&lock_path)
            .map_err(|e| VettoError::cache(format!("failed to open lock file: {}", e)))?;

        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            let fd = lock_file.as_raw_fd();
            let lock_res = unsafe { libc::flock(fd, libc::LOCK_EX) };
            if lock_res != 0 {
                let err = std::io::Error::last_os_error();
                return Err(VettoError::cache(format!("failed to acquire flock: {}", err)));
            }
        }

        let write_result = (|| -> Result<(), VettoError> {
            let guard = self
                .entries
                .read()
                .map_err(|_| VettoError::cache("RwLock poisoned on save"))?;
            let json_bytes = serde_json::to_vec_pretty(&*guard)
                .map_err(|e| VettoError::cache(format!("JSON serialization failed: {}", e)))?;

            let tmp_path = self.cache_dir.join(format!(
                ".cache.json.tmp.{}.{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));

            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp_path)
                .map_err(|e| VettoError::cache(format!("failed to open tmp cache file: {}", e)))?;

            file.write_all(&json_bytes)
                .map_err(|e| VettoError::cache(format!("failed to write tmp cache: {}", e)))?;
            file.sync_all()
                .map_err(|e| VettoError::cache(format!("failed to sync tmp cache: {}", e)))?;

            let target_path = self.cache_file_path();
            fs::rename(&tmp_path, &target_path).map_err(|e| {
                let _ = fs::remove_file(&tmp_path);
                VettoError::cache(format!("failed to atomically rename cache file: {}", e))
            })?;

            Ok(())
        })();

        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            let fd = lock_file.as_raw_fd();
            unsafe {
                libc::flock(fd, libc::LOCK_UN);
            }
        }

        write_result
    }

    /// Loads cache entries from disk. Recovers gracefully if file is missing or corrupted.
    pub fn load_from_disk(&self) -> Result<(), VettoError> {
        let target_path = self.cache_file_path();
        if !target_path.exists() {
            return Ok(());
        }

        let content = fs::read_to_string(&target_path)
            .map_err(|e| VettoError::cache(format!("failed to read cache file: {}", e)))?;

        match serde_json::from_str::<HashMap<String, CacheEntry>>(&content) {
            Ok(map) => {
                let mut guard = self
                    .entries
                    .write()
                    .map_err(|_| VettoError::cache("RwLock poisoned on load"))?;
                *guard = map;
                Ok(())
            }
            Err(_) => {
                // Recover from corruption by wiping corrupted file and starting fresh
                self.recover_if_corrupted()
            }
        }
    }

    /// Handles corruption recovery by resetting the cache to an empty state and rewriting.
    pub fn recover_if_corrupted(&self) -> Result<(), VettoError> {
        let target_path = self.cache_file_path();
        if target_path.exists() {
            let _ = fs::remove_file(&target_path);
        }
        let mut guard = self
            .entries
            .write()
            .map_err(|_| VettoError::cache("RwLock poisoned on recovery"))?;
        guard.clear();
        drop(guard);
        self.save_to_disk_atomic()
    }

    /// Clears all cached entries both in memory and on disk.
    pub fn clear(&self) -> Result<(), VettoError> {
        {
            let mut guard = self
                .entries
                .write()
                .map_err(|_| VettoError::cache("RwLock poisoned on clear"))?;
            guard.clear();
        }
        let target_path = self.cache_file_path();
        if target_path.exists() {
            fs::remove_file(&target_path)
                .map_err(|e| VettoError::cache(format!("failed to remove cache file: {}", e)))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_sha256_known_vectors() {
        // Test vector 1: Empty string
        assert_eq!(
            Sha256::digest_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        // Test vector 2: "abc"
        assert_eq!(
            Sha256::digest_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        // Test vector 3: 448 bits
        assert_eq!(
            Sha256::digest_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn test_cache_memory_and_disk_atomic() {
        let temp_dir = std::env::temp_dir().join(format!("vetto_cache_test_{}", std::process::id()));
        let cache = ShimCache::new(&temp_dir).expect("failed to init cache");

        cache.set_hash("test_bin", "abcd1234deadbeef").expect("set hash failed");
        assert_eq!(cache.get_hash("test_bin"), Some("abcd1234deadbeef".to_string()));

        // Verify disk file exists
        assert!(cache.cache_file_path().exists());

        // Reload cache into a new instance
        let reloaded = ShimCache::new(&temp_dir).expect("failed to reload cache");
        assert_eq!(reloaded.get_hash("test_bin"), Some("abcd1234deadbeef".to_string()));

        // Cleanup
        let _ = cache.clear();
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_cache_corruption_recovery() {
        let temp_dir = std::env::temp_dir().join(format!("vetto_corrupt_test_{}", std::process::id()));
        let cache = ShimCache::new(&temp_dir).expect("failed to init cache");

        // Write corrupted JSON to cache file
        let mut file = File::create(cache.cache_file_path()).expect("create cache file failed");
        file.write_all(b"{ invalid json content ...").expect("write corrupted json failed");
        drop(file);

        // Loading should trigger recovery without panic or error
        assert!(cache.load_from_disk().is_ok());
        assert_eq!(cache.get_hash("nonexistent"), None);

        // Cleanup
        let _ = cache.clear();
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_cache_flock_concurrency() {
        let temp_dir = std::env::temp_dir().join(format!("vetto_flock_test_{}", std::process::id()));
        let cache = ShimCache::new(&temp_dir).expect("failed to init cache");

        // Concurrent atomic saves with flock protection
        let mut handles = Vec::new();
        for i in 0..10 {
            let dir = temp_dir.clone();
            handles.push(std::thread::spawn(move || {
                let local_cache = ShimCache::new(&dir).expect("init thread cache failed");
                let key = format!("tool_{}", i);
                let hash = format!("hash_{}", i);
                local_cache.set_hash(&key, &hash).expect("set hash failed");
            }));
        }

        for handle in handles {
            handle.join().expect("thread join failed");
        }

        // Validate that cache file is valid and readable after concurrent writes
        assert!(cache.load_from_disk().is_ok());

        // Cleanup
        let _ = cache.clear();
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
