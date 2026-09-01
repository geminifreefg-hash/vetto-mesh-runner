use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use vetto_core::landlock::{detect_abi_version, is_supported as is_landlock_supported};
use vetto_core::seccomp::is_supported as is_seccomp_supported;
use vetto_core::VettoError;
use vetto_shims::cache::ShimCache;
use vetto_shims::interceptor::ShimInterceptor;

/// Local user configuration for VETTO security policies.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VettoConfig {
    pub enabled: bool,
    pub telemetry_enabled: bool,
    pub allowed_paths_ro: Vec<PathBuf>,
    pub allowed_paths_rw: Vec<PathBuf>,
    pub allowed_ports: Vec<u16>,
    pub denied_syscalls: Vec<i32>,
}

impl Default for VettoConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            telemetry_enabled: false, // Default fail-closed privacy: telemetry disabled
            allowed_paths_ro: vec![
                PathBuf::from("/usr"),
                PathBuf::from("/lib"),
                PathBuf::from("/lib64"),
                PathBuf::from("/bin"),
                PathBuf::from("/etc"),
            ],
            allowed_paths_rw: vec![PathBuf::from("/tmp"), PathBuf::from("/var/tmp")],
            allowed_ports: vec![80, 443],
            denied_syscalls: vec![101, 165, 321], // ptrace, mount, bpf
        }
    }
}

impl VettoConfig {
    /// Returns default path for VETTO configuration file: ~/.config/vetto/config.json
    pub fn config_path() -> PathBuf {
        let home = env::var_os("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join(".config")
            .join("vetto")
            .join("config.json")
    }

    /// Loads configuration from disk, creating defaults if missing.
    pub fn load() -> Self {
        let path = Self::config_path();
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<Self>(&content) {
                return cfg;
            }
        }
        Self::default()
    }

    /// Saves configuration atomically to disk.
    pub fn save(&self) -> Result<(), VettoError> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let json = serde_json::to_string_pretty(self).map_err(|e| {
            VettoError::InvalidConfiguration(format!("failed to serialize config: {}", e))
        })?;

        let tmp_path = path.with_extension("tmp");
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|e| VettoError::Io(e))?;

        file.write_all(json.as_bytes())
            .map_err(|e| VettoError::Io(e))?;
        file.sync_all().map_err(|e| VettoError::Io(e))?;

        fs::rename(&tmp_path, &path).map_err(|e| VettoError::Io(e))?;
        Ok(())
    }
}

#[derive(Parser, Debug)]
#[command(
    name = "vetto",
    version = "0.2.16",
    about = "VETTO: Autonomous Fail-Closed Security Sandbox & Landlock Guard",
    long_about = "High-performance Linux kernel Landlock ABI v5 and Seccomp BPF security sandboxing system."
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Run a command inside a hardened Landlock + Seccomp sandbox
    Run {
        /// Additional read-only filesystem paths to allow
        #[arg(long = "ro", value_name = "PATH")]
        ro_paths: Vec<PathBuf>,

        /// Additional read-write filesystem paths to allow
        #[arg(long = "rw", value_name = "PATH")]
        rw_paths: Vec<PathBuf>,

        /// Additional executable filesystem paths to allow
        #[arg(long = "exec", value_name = "PATH")]
        exec_paths: Vec<PathBuf>,

        /// Allow outbound TCP network access to specified port
        #[arg(long = "port", value_name = "PORT")]
        ports: Vec<u16>,

        /// Enable best-effort mode (gracefully degrade if kernel lacks features)
        #[arg(long = "best-effort")]
        best_effort: bool,

        /// Command binary to execute
        command: String,

        /// Arguments passed to the target binary
        #[arg(trailing_var_arg = true)]
        args: Vec<String>,
    },

    /// Install a PATH shim interceptor for a given target binary
    Wrap {
        /// Target binary name to wrap (e.g. curl, git, python3)
        target: String,

        /// Destination directory for the shim wrapper (default: ~/.vetto/shims)
        #[arg(long = "dest-dir")]
        dest_dir: Option<PathBuf>,

        /// Overwrite existing shim executable
        #[arg(short = 'f', long = "force")]
        force: bool,
    },

    /// Check kernel Landlock ABI version and Seccomp BPF support
    Check {
        /// Show detailed kernel capability report
        #[arg(short = 'v', long = "verbose")]
        verbose: bool,
    },

    /// Run comprehensive system security health diagnosis
    Doctor {
        /// Output diagnosis report in JSON format
        #[arg(long = "json")]
        json: bool,
    },

    /// Enable sandboxing enforcement for a binary or profile
    Enable {
        /// Target name or profile
        target: Option<String>,
    },

    /// Disable sandboxing enforcement for a binary or profile
    Disable {
        /// Target name or profile
        target: Option<String>,
    },

    /// Add an allowed path or network port to local configuration
    Allow {
        /// Filesystem path to allow
        #[arg(long = "path")]
        path: Option<PathBuf>,

        /// Allow path with read-write permissions (default is read-only)
        #[arg(long = "rw")]
        read_write: bool,

        /// TCP network port to allow
        #[arg(long = "port")]
        port: Option<u16>,
    },

    /// Add a denied system call or path to local configuration
    Deny {
        /// System call number to deny via Seccomp BPF
        #[arg(long = "syscall")]
        syscall: Option<i32>,
    },

    /// Inspect active security policies and shim cache status
    Inspect {
        /// Show current cache entries
        #[arg(long = "cache")]
        cache: bool,

        /// Show active policy rules
        #[arg(long = "policy")]
        policy: bool,
    },

    /// Configure anonymous telemetry opt-out preference
    Telemetry {
        /// Explicitly opt-out and disable all telemetry
        #[arg(long = "opt-out")]
        opt_out: bool,

        /// Display current telemetry status
        #[arg(long = "status")]
        status: bool,
    },
}

fn handle_run(
    ro_paths: Vec<PathBuf>,
    rw_paths: Vec<PathBuf>,
    exec_paths: Vec<PathBuf>,
    ports: Vec<u16>,
    best_effort: bool,
    command: String,
    args: Vec<String>,
) -> Result<ExitCode, VettoError> {
    let mut interceptor = ShimInterceptor::new(&command);
    interceptor.best_effort(best_effort);

    // Forward allowed network ports
    for port in ports {
        interceptor.allow_port(port);
    }

    // Add default system paths
    let default_ro = ["/usr", "/lib", "/lib64", "/bin", "/etc", "/dev/urandom", "/dev/null"];
    for p in &default_ro {
        interceptor.allow_read_path(p);
    }

    // Add user configured paths
    for p in ro_paths {
        interceptor.allow_read_path(p);
    }
    for p in rw_paths {
        interceptor.allow_write_path(p);
    }
    for p in exec_paths {
        interceptor.allow_exec_path(p);
    }

    let status = interceptor.wrap_execution(&args)?;
    let code = status.code().unwrap_or(1);
    Ok(ExitCode::from(code as u8))
}

fn handle_wrap(target: String, dest_dir: Option<PathBuf>, force: bool) -> Result<(), VettoError> {
    let home = env::var_os("HOME").unwrap_or_default();
    let shim_dir = dest_dir.unwrap_or_else(|| PathBuf::from(home).join(".vetto").join("shims"));
    fs::create_dir_all(&shim_dir).map_err(|e| VettoError::Io(e))?;

    let shim_path = shim_dir.join(&target);
    if shim_path.exists() && !force {
        eprintln!(
            "Error: Shim for '{}' already exists at {:?}. Use --force to overwrite.",
            target, shim_path
        );
        return Err(VettoError::invalid_rule("shim file already exists"));
    }

    let current_exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("vetto"));
    let script = format!(
        "#!/bin/sh\nexec {:?} run -- {:?} \"$@\"\n",
        current_exe.display(),
        target
    );

    let mut file = File::create(&shim_path).map_err(|e| VettoError::Io(e))?;
    file.write_all(script.as_bytes())
        .map_err(|e| VettoError::Io(e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file.metadata().map_err(|e| VettoError::Io(e))?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&shim_path, perms).map_err(|e| VettoError::Io(e))?;
    }

    println!(
        "Installed VETTO shim for '{}' at {:?}\nAdd {:?} to your PATH to activate.",
        target, shim_path, shim_dir
    );
    Ok(())
}

fn handle_check(verbose: bool) -> Result<(), VettoError> {
    println!("=== VETTO Kernel Security Capabilities ===");
    let landlock_ok = is_landlock_supported();
    let landlock_abi = detect_abi_version().unwrap_or(0);
    let seccomp_ok = is_seccomp_supported();

    println!("Landlock Supported : {}", if landlock_ok { "YES" } else { "NO" });
    println!("Landlock ABI Level : v{}", landlock_abi);
    println!("Seccomp BPF Filter : {}", if seccomp_ok { "YES" } else { "NO" });

    if verbose {
        println!("\nDetailed ABI Breakdown:");
        println!("  - ABI v1 (FS Basic)        : {}", if landlock_abi >= 1 { "Supported" } else { "Unsupported" });
        println!("  - ABI v2 (FS Refer)        : {}", if landlock_abi >= 2 { "Supported" } else { "Unsupported" });
        println!("  - ABI v3 (FS Truncate)     : {}", if landlock_abi >= 3 { "Supported" } else { "Unsupported" });
        println!("  - ABI v4 (Net TCP Port)    : {}", if landlock_abi >= 4 { "Supported" } else { "Unsupported" });
        println!("  - ABI v5 (Signals/IOCTL)   : {}", if landlock_abi >= 5 { "Supported" } else { "Unsupported" });
    }

    Ok(())
}

#[derive(Serialize)]
struct DoctorReport {
    kernel_landlock_supported: bool,
    kernel_landlock_abi: i32,
    kernel_seccomp_supported: bool,
    config_enabled: bool,
    telemetry_opted_out: bool,
    cache_entries_count: usize,
    status_verdict: String,
}

fn handle_doctor(json: bool) -> Result<(), VettoError> {
    let landlock_ok = is_landlock_supported();
    let landlock_abi = detect_abi_version().unwrap_or(0);
    let seccomp_ok = is_seccomp_supported();
    let config = VettoConfig::load();

    let cache_dir = PathBuf::from(env::var_os("HOME").unwrap_or_default())
        .join(".cache")
        .join("vetto");
    let cache_count = if let Ok(cache) = ShimCache::new(&cache_dir) {
        if let Ok(content) = fs::read_to_string(cache.cache_file_path()) {
            serde_json::from_str::<serde_json::Value>(&content)
                .map(|v| v.as_object().map(|o| o.len()).unwrap_or(0))
                .unwrap_or(0)
        } else {
            0
        }
    } else {
        0
    };

    let verdict = if landlock_ok && seccomp_ok {
        "HEALTHY: Full kernel security sandboxing active"
    } else if landlock_ok || seccomp_ok {
        "DEGRADED: Partial security features available"
    } else {
        "UNSUPPORTED: Missing kernel Landlock/Seccomp support"
    };

    if json {
        let report = DoctorReport {
            kernel_landlock_supported: landlock_ok,
            kernel_landlock_abi: landlock_abi,
            kernel_seccomp_supported: seccomp_ok,
            config_enabled: config.enabled,
            telemetry_opted_out: !config.telemetry_enabled,
            cache_entries_count: cache_count,
            status_verdict: verdict.to_string(),
        };
        let out = serde_json::to_string_pretty(&report)
            .map_err(|e| VettoError::InvalidConfiguration(e.to_string()))?;
        println!("{}", out);
    } else {
        println!("=== VETTO Doctor System Diagnostics ===");
        println!("Landlock Status  : {} (ABI v{})", if landlock_ok { "PASS" } else { "FAIL" }, landlock_abi);
        println!("Seccomp Status   : {}", if seccomp_ok { "PASS" } else { "FAIL" });
        println!("Policy Enabled   : {}", config.enabled);
        println!("Telemetry Opt-Out: {}", !config.telemetry_enabled);
        println!("Cached Binaries  : {}", cache_count);
        println!("Verdict          : {}", verdict);
    }

    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Run {
            ro_paths,
            rw_paths,
            exec_paths,
            ports,
            best_effort,
            command,
            args,
        } => handle_run(
            ro_paths,
            rw_paths,
            exec_paths,
            ports,
            best_effort,
            command,
            args,
        ),
        Commands::Wrap {
            target,
            dest_dir,
            force,
        } => handle_wrap(target, dest_dir, force).map(|_| ExitCode::SUCCESS),
        Commands::Check { verbose } => handle_check(verbose).map(|_| ExitCode::SUCCESS),
        Commands::Doctor { json } => handle_doctor(json).map(|_| ExitCode::SUCCESS),
        Commands::Enable { target } => {
            let mut config = VettoConfig::load();
            config.enabled = true;
            let _ = config.save();
            println!(
                "VETTO sandboxing enabled{}",
                target.map(|t| format!(" for '{}'", t)).unwrap_or_default()
            );
            Ok(ExitCode::SUCCESS)
        }
        Commands::Disable { target } => {
            let mut config = VettoConfig::load();
            config.enabled = false;
            let _ = config.save();
            println!(
                "VETTO sandboxing disabled{}",
                target.map(|t| format!(" for '{}'", t)).unwrap_or_default()
            );
            Ok(ExitCode::SUCCESS)
        }
        Commands::Allow {
            path,
            read_write,
            port,
        } => {
            let mut config = VettoConfig::load();
            if let Some(p) = path {
                if read_write {
                    config.allowed_paths_rw.push(p.clone());
                    println!("Added read-write path allow rule: {:?}", p);
                } else {
                    config.allowed_paths_ro.push(p.clone());
                    println!("Added read-only path allow rule: {:?}", p);
                }
            }
            if let Some(prt) = port {
                config.allowed_ports.push(prt);
                println!("Added TCP port allow rule: {}", prt);
            }
            let _ = config.save();
            Ok(ExitCode::SUCCESS)
        }
        Commands::Deny { syscall } => {
            let mut config = VettoConfig::load();
            if let Some(nr) = syscall {
                config.denied_syscalls.push(nr);
                println!("Added Seccomp BPF syscall deny rule: nr {}", nr);
            }
            let _ = config.save();
            Ok(ExitCode::SUCCESS)
        }
        Commands::Inspect { cache, policy } => {
            let config = VettoConfig::load();
            if policy || (!cache && !policy) {
                println!("=== Active VETTO Policy Configuration ===");
                println!("Enabled: {}", config.enabled);
                println!("Read-Only Paths: {:?}", config.allowed_paths_ro);
                println!("Read-Write Paths: {:?}", config.allowed_paths_rw);
                println!("Allowed Ports: {:?}", config.allowed_ports);
                println!("Denied Syscalls: {:?}", config.denied_syscalls);
            }
            if cache {
                println!("=== Shim Cache Diagnostics ===");
                let cache_dir = PathBuf::from(env::var_os("HOME").unwrap_or_default())
                    .join(".cache")
                    .join("vetto");
                if let Ok(c) = ShimCache::new(&cache_dir) {
                    println!("Cache Directory: {:?}", cache_dir);
                    println!("Cache File: {:?}", c.cache_file_path());
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        Commands::Telemetry { opt_out, status } => {
            let mut config = VettoConfig::load();
            if opt_out {
                config.telemetry_enabled = false;
                let _ = config.save();
                println!("Telemetry preference updated: OPTED OUT (telemetry disabled).");
            } else if status {
                println!(
                    "Telemetry status: {}",
                    if config.telemetry_enabled {
                        "ENABLED"
                    } else {
                        "DISABLED (Opted Out)"
                    }
                );
            } else {
                println!("Telemetry is disabled by default for fail-closed privacy. Use --opt-out or --status.");
            }
            Ok(ExitCode::SUCCESS)
        }
    };

    match result {
        Ok(code) => code,
        Err(err) => {
            eprintln!("VETTO Error: {}", err);
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vetto_config_defaults() {
        let config = VettoConfig::default();
        assert!(config.enabled);
        assert!(!config.telemetry_enabled);
        assert!(config.allowed_paths_ro.len() >= 4);
        assert!(config.denied_syscalls.contains(&101)); // ptrace
    }

    #[test]
    fn test_vetto_config_serialization() {
        let config = VettoConfig::default();
        let json = serde_json::to_string(&config).expect("failed to serialize");
        let deserialized: VettoConfig = serde_json::from_str(&json).expect("failed to deserialize");
        assert_eq!(config.enabled, deserialized.enabled);
        assert_eq!(config.telemetry_enabled, deserialized.telemetry_enabled);
        assert_eq!(config.allowed_ports, vec![80, 443]);
    }

    #[test]
    fn test_cli_parse_run_with_ports() {
        let args = vec![
            "vetto", "run", "--port", "80", "--port", "443", "--ro", "/usr", "--", "curl", "https://example.com"
        ];
        let cli = Cli::try_parse_from(args).expect("failed to parse cli args");
        match cli.command {
            Commands::Run { ports, ro_paths, command, args, .. } => {
                assert_eq!(ports, vec![80, 443]);
                assert_eq!(ro_paths, vec![PathBuf::from("/usr")]);
                assert_eq!(command, "curl");
                assert_eq!(args, vec!["https://example.com".to_string()]);
            }
            _ => assert!(false, "unexpected command parsed"),
        }
    }
}
