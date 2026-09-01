use crate::error::VettoError;
use crate::landlock::abi_v5::prctl_set_no_new_privs;
use std::collections::BTreeMap;

// --- BPF Instruction Classes & Constants ---
pub const BPF_LD: u16 = 0x00;
pub const BPF_W: u16 = 0x00;
pub const BPF_ABS: u16 = 0x20;
pub const BPF_JMP: u16 = 0x05;
pub const BPF_JEQ: u16 = 0x10;
pub const BPF_JGT: u16 = 0x20;
pub const BPF_JGE: u16 = 0x30;
pub const BPF_JA: u16 = 0x00;
pub const BPF_RET: u16 = 0x06;
pub const BPF_K: u16 = 0x00;

// --- Seccomp Return Action Codes ---
pub const SECCOMP_RET_KILL_PROCESS: u32 = 0x80000000;
pub const SECCOMP_RET_KILL_THREAD: u32 = 0x00000000;
pub const SECCOMP_RET_TRAP: u32 = 0x00030000;
pub const SECCOMP_RET_ERRNO: u32 = 0x00050000;
pub const SECCOMP_RET_TRACE: u32 = 0x7ff00000;
pub const SECCOMP_RET_LOG: u32 = 0x7ffc0000;
pub const SECCOMP_RET_ALLOW: u32 = 0x7fff0000;
pub const SECCOMP_RET_ACTION_FULL: u32 = 0xffff0000;
pub const SECCOMP_RET_DATA: u32 = 0x0000ffff;

// --- Linux Classic BPF Instruction Limits ---
pub const BPF_MAXINSNS: usize = 4096;

// --- Linux x86_64 x32 Syscall Bit Mask ---
pub const __X32_SYSCALL_BIT: u32 = 0x40000000;

// --- Audit Architecture Constants ---
pub const AUDIT_ARCH_X86_64: u32 = 0xc000003e;
pub const AUDIT_ARCH_AARCH64: u32 = 0xc00000b7;
pub const AUDIT_ARCH_RISCV64: u32 = 0xc00000f3;
pub const AUDIT_ARCH_I386: u32 = 0x40000003;
pub const AUDIT_ARCH_ARM: u32 = 0x40000028;

// --- Offsets within struct seccomp_data ---
pub const SECCOMP_DATA_NR_OFFSET: u32 = 0;
pub const SECCOMP_DATA_ARCH_OFFSET: u32 = 4;
pub const SECCOMP_DATA_IP_OFFSET: u32 = 8;
pub const SECCOMP_DATA_ARGS_OFFSET: u32 = 16;

// --- Architecture-Specific Syscall Numbers: x86_64 ---
pub const X86_64_SYS_PTRACE: i32 = 101;
pub const X86_64_SYS_PROCESS_VM_READV: i32 = 310;
pub const X86_64_SYS_PROCESS_VM_WRITEV: i32 = 311;
pub const X86_64_SYS_KEXEC_LOAD: i32 = 246;
pub const X86_64_SYS_KEXEC_FILE_LOAD: i32 = 320;
pub const X86_64_SYS_REBOOT: i32 = 169;
pub const X86_64_SYS_MOUNT: i32 = 165;
pub const X86_64_SYS_UMOUNT2: i32 = 166;
pub const X86_64_SYS_PIVOT_ROOT: i32 = 155;
pub const X86_64_SYS_SWAPON: i32 = 167;
pub const X86_64_SYS_SWAPOFF: i32 = 168;
pub const X86_64_SYS_USERFAULTFD: i32 = 323;
pub const X86_64_SYS_BPF: i32 = 321;
pub const X86_64_SYS_KEYCTL: i32 = 250;
pub const X86_64_SYS_ADD_KEY: i32 = 248;
pub const X86_64_SYS_REQUEST_KEY: i32 = 249;
pub const X86_64_SYS_ACCT: i32 = 163;
pub const X86_64_SYS_IOPERM: i32 = 173;
pub const X86_64_SYS_IOPL: i32 = 172;
pub const X86_64_SYS_INIT_MODULE: i32 = 175;
pub const X86_64_SYS_DELETE_MODULE: i32 = 176;
pub const X86_64_SYS_FINIT_MODULE: i32 = 313;

// --- Architecture-Specific Syscall Numbers: AARCH64 (ARM64) ---
pub const AARCH64_SYS_PTRACE: i32 = 117;
pub const AARCH64_SYS_PROCESS_VM_READV: i32 = 270;
pub const AARCH64_SYS_PROCESS_VM_WRITEV: i32 = 271;
pub const AARCH64_SYS_KEXEC_LOAD: i32 = 104;
pub const AARCH64_SYS_KEXEC_FILE_LOAD: i32 = 294;
pub const AARCH64_SYS_REBOOT: i32 = 142;
pub const AARCH64_SYS_MOUNT: i32 = 40;
pub const AARCH64_SYS_UMOUNT2: i32 = 39;
pub const AARCH64_SYS_PIVOT_ROOT: i32 = 41;
pub const AARCH64_SYS_SWAPON: i32 = 224;
pub const AARCH64_SYS_SWAPOFF: i32 = 225;
pub const AARCH64_SYS_USERFAULTFD: i32 = 282;
pub const AARCH64_SYS_BPF: i32 = 280;
pub const AARCH64_SYS_KEYCTL: i32 = 219;
pub const AARCH64_SYS_ADD_KEY: i32 = 217;
pub const AARCH64_SYS_REQUEST_KEY: i32 = 218;
pub const AARCH64_SYS_ACCT: i32 = 89;
pub const AARCH64_SYS_INIT_MODULE: i32 = 105;
pub const AARCH64_SYS_DELETE_MODULE: i32 = 106;
pub const AARCH64_SYS_FINIT_MODULE: i32 = 273;

// --- Architecture-Specific Syscall Numbers: RISCV64 (Linux asm-generic) ---
pub const RISCV64_SYS_PTRACE: i32 = 117;
pub const RISCV64_SYS_PROCESS_VM_READV: i32 = 270;
pub const RISCV64_SYS_PROCESS_VM_WRITEV: i32 = 271;
pub const RISCV64_SYS_KEXEC_LOAD: i32 = 104;
pub const RISCV64_SYS_KEXEC_FILE_LOAD: i32 = 294;
pub const RISCV64_SYS_REBOOT: i32 = 142;
pub const RISCV64_SYS_MOUNT: i32 = 40;
pub const RISCV64_SYS_UMOUNT2: i32 = 39;
pub const RISCV64_SYS_PIVOT_ROOT: i32 = 41;
pub const RISCV64_SYS_SWAPON: i32 = 224;
pub const RISCV64_SYS_SWAPOFF: i32 = 225;
pub const RISCV64_SYS_USERFAULTFD: i32 = 282;
pub const RISCV64_SYS_BPF: i32 = 280;
pub const RISCV64_SYS_KEYCTL: i32 = 219;
pub const RISCV64_SYS_ADD_KEY: i32 = 217;
pub const RISCV64_SYS_REQUEST_KEY: i32 = 218;
pub const RISCV64_SYS_ACCT: i32 = 89;
pub const RISCV64_SYS_INIT_MODULE: i32 = 105;
pub const RISCV64_SYS_DELETE_MODULE: i32 = 106;
pub const RISCV64_SYS_FINIT_MODULE: i32 = 273;

// --- Target Architecture Native Syscall Constants ---
#[cfg(target_arch = "x86_64")]
pub const SYS_PTRACE: i32 = X86_64_SYS_PTRACE;
#[cfg(target_arch = "x86_64")]
pub const SYS_PROCESS_VM_READV: i32 = X86_64_SYS_PROCESS_VM_READV;
#[cfg(target_arch = "x86_64")]
pub const SYS_PROCESS_VM_WRITEV: i32 = X86_64_SYS_PROCESS_VM_WRITEV;
#[cfg(target_arch = "x86_64")]
pub const SYS_KEXEC_LOAD: i32 = X86_64_SYS_KEXEC_LOAD;
#[cfg(target_arch = "x86_64")]
pub const SYS_KEXEC_FILE_LOAD: i32 = X86_64_SYS_KEXEC_FILE_LOAD;
#[cfg(target_arch = "x86_64")]
pub const SYS_REBOOT: i32 = X86_64_SYS_REBOOT;
#[cfg(target_arch = "x86_64")]
pub const SYS_MOUNT: i32 = X86_64_SYS_MOUNT;
#[cfg(target_arch = "x86_64")]
pub const SYS_UMOUNT2: i32 = X86_64_SYS_UMOUNT2;
#[cfg(target_arch = "x86_64")]
pub const SYS_PIVOT_ROOT: i32 = X86_64_SYS_PIVOT_ROOT;
#[cfg(target_arch = "x86_64")]
pub const SYS_SWAPON: i32 = X86_64_SYS_SWAPON;
#[cfg(target_arch = "x86_64")]
pub const SYS_SWAPOFF: i32 = X86_64_SYS_SWAPOFF;
#[cfg(target_arch = "x86_64")]
pub const SYS_USERFAULTFD: i32 = X86_64_SYS_USERFAULTFD;
#[cfg(target_arch = "x86_64")]
pub const SYS_BPF: i32 = X86_64_SYS_BPF;
#[cfg(target_arch = "x86_64")]
pub const SYS_KEYCTL: i32 = X86_64_SYS_KEYCTL;
#[cfg(target_arch = "x86_64")]
pub const SYS_ADD_KEY: i32 = X86_64_SYS_ADD_KEY;
#[cfg(target_arch = "x86_64")]
pub const SYS_REQUEST_KEY: i32 = X86_64_SYS_REQUEST_KEY;
#[cfg(target_arch = "x86_64")]
pub const SYS_ACCT: i32 = X86_64_SYS_ACCT;
#[cfg(target_arch = "x86_64")]
pub const SYS_IOPERM: i32 = X86_64_SYS_IOPERM;
#[cfg(target_arch = "x86_64")]
pub const SYS_IOPL: i32 = X86_64_SYS_IOPL;
#[cfg(target_arch = "x86_64")]
pub const SYS_INIT_MODULE: i32 = X86_64_SYS_INIT_MODULE;
#[cfg(target_arch = "x86_64")]
pub const SYS_DELETE_MODULE: i32 = X86_64_SYS_DELETE_MODULE;
#[cfg(target_arch = "x86_64")]
pub const SYS_FINIT_MODULE: i32 = X86_64_SYS_FINIT_MODULE;

#[cfg(target_arch = "aarch64")]
pub const SYS_PTRACE: i32 = AARCH64_SYS_PTRACE;
#[cfg(target_arch = "aarch64")]
pub const SYS_PROCESS_VM_READV: i32 = AARCH64_SYS_PROCESS_VM_READV;
#[cfg(target_arch = "aarch64")]
pub const SYS_PROCESS_VM_WRITEV: i32 = AARCH64_SYS_PROCESS_VM_WRITEV;
#[cfg(target_arch = "aarch64")]
pub const SYS_KEXEC_LOAD: i32 = AARCH64_SYS_KEXEC_LOAD;
#[cfg(target_arch = "aarch64")]
pub const SYS_KEXEC_FILE_LOAD: i32 = AARCH64_SYS_KEXEC_FILE_LOAD;
#[cfg(target_arch = "aarch64")]
pub const SYS_REBOOT: i32 = AARCH64_SYS_REBOOT;
#[cfg(target_arch = "aarch64")]
pub const SYS_MOUNT: i32 = AARCH64_SYS_MOUNT;
#[cfg(target_arch = "aarch64")]
pub const SYS_UMOUNT2: i32 = AARCH64_SYS_UMOUNT2;
#[cfg(target_arch = "aarch64")]
pub const SYS_PIVOT_ROOT: i32 = AARCH64_SYS_PIVOT_ROOT;
#[cfg(target_arch = "aarch64")]
pub const SYS_SWAPON: i32 = AARCH64_SYS_SWAPON;
#[cfg(target_arch = "aarch64")]
pub const SYS_SWAPOFF: i32 = AARCH64_SYS_SWAPOFF;
#[cfg(target_arch = "aarch64")]
pub const SYS_USERFAULTFD: i32 = AARCH64_SYS_USERFAULTFD;
#[cfg(target_arch = "aarch64")]
pub const SYS_BPF: i32 = AARCH64_SYS_BPF;
#[cfg(target_arch = "aarch64")]
pub const SYS_KEYCTL: i32 = AARCH64_SYS_KEYCTL;
#[cfg(target_arch = "aarch64")]
pub const SYS_ADD_KEY: i32 = AARCH64_SYS_ADD_KEY;
#[cfg(target_arch = "aarch64")]
pub const SYS_REQUEST_KEY: i32 = AARCH64_SYS_REQUEST_KEY;
#[cfg(target_arch = "aarch64")]
pub const SYS_ACCT: i32 = AARCH64_SYS_ACCT;
#[cfg(target_arch = "aarch64")]
pub const SYS_IOPERM: i32 = -1;
#[cfg(target_arch = "aarch64")]
pub const SYS_IOPL: i32 = -1;
#[cfg(target_arch = "aarch64")]
pub const SYS_INIT_MODULE: i32 = AARCH64_SYS_INIT_MODULE;
#[cfg(target_arch = "aarch64")]
pub const SYS_DELETE_MODULE: i32 = AARCH64_SYS_DELETE_MODULE;
#[cfg(target_arch = "aarch64")]
pub const SYS_FINIT_MODULE: i32 = AARCH64_SYS_FINIT_MODULE;

#[cfg(target_arch = "riscv64")]
pub const SYS_PTRACE: i32 = RISCV64_SYS_PTRACE;
#[cfg(target_arch = "riscv64")]
pub const SYS_PROCESS_VM_READV: i32 = RISCV64_SYS_PROCESS_VM_READV;
#[cfg(target_arch = "riscv64")]
pub const SYS_PROCESS_VM_WRITEV: i32 = RISCV64_SYS_PROCESS_VM_WRITEV;
#[cfg(target_arch = "riscv64")]
pub const SYS_KEXEC_LOAD: i32 = RISCV64_SYS_KEXEC_LOAD;
#[cfg(target_arch = "riscv64")]
pub const SYS_KEXEC_FILE_LOAD: i32 = RISCV64_SYS_KEXEC_FILE_LOAD;
#[cfg(target_arch = "riscv64")]
pub const SYS_REBOOT: i32 = RISCV64_SYS_REBOOT;
#[cfg(target_arch = "riscv64")]
pub const SYS_MOUNT: i32 = RISCV64_SYS_MOUNT;
#[cfg(target_arch = "riscv64")]
pub const SYS_UMOUNT2: i32 = RISCV64_SYS_UMOUNT2;
#[cfg(target_arch = "riscv64")]
pub const SYS_PIVOT_ROOT: i32 = RISCV64_SYS_PIVOT_ROOT;
#[cfg(target_arch = "riscv64")]
pub const SYS_SWAPON: i32 = RISCV64_SYS_SWAPON;
#[cfg(target_arch = "riscv64")]
pub const SYS_SWAPOFF: i32 = RISCV64_SYS_SWAPOFF;
#[cfg(target_arch = "riscv64")]
pub const SYS_USERFAULTFD: i32 = RISCV64_SYS_USERFAULTFD;
#[cfg(target_arch = "riscv64")]
pub const SYS_BPF: i32 = RISCV64_SYS_BPF;
#[cfg(target_arch = "riscv64")]
pub const SYS_KEYCTL: i32 = RISCV64_SYS_KEYCTL;
#[cfg(target_arch = "riscv64")]
pub const SYS_ADD_KEY: i32 = RISCV64_SYS_ADD_KEY;
#[cfg(target_arch = "riscv64")]
pub const SYS_REQUEST_KEY: i32 = RISCV64_SYS_REQUEST_KEY;
#[cfg(target_arch = "riscv64")]
pub const SYS_ACCT: i32 = RISCV64_SYS_ACCT;
#[cfg(target_arch = "riscv64")]
pub const SYS_IOPERM: i32 = -1;
#[cfg(target_arch = "riscv64")]
pub const SYS_IOPL: i32 = -1;
#[cfg(target_arch = "riscv64")]
pub const SYS_INIT_MODULE: i32 = RISCV64_SYS_INIT_MODULE;
#[cfg(target_arch = "riscv64")]
pub const SYS_DELETE_MODULE: i32 = RISCV64_SYS_DELETE_MODULE;
#[cfg(target_arch = "riscv64")]
pub const SYS_FINIT_MODULE: i32 = RISCV64_SYS_FINIT_MODULE;

#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_PTRACE: i32 = X86_64_SYS_PTRACE;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_PROCESS_VM_READV: i32 = X86_64_SYS_PROCESS_VM_READV;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_PROCESS_VM_WRITEV: i32 = X86_64_SYS_PROCESS_VM_WRITEV;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_KEXEC_LOAD: i32 = X86_64_SYS_KEXEC_LOAD;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_KEXEC_FILE_LOAD: i32 = X86_64_SYS_KEXEC_FILE_LOAD;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_REBOOT: i32 = X86_64_SYS_REBOOT;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_MOUNT: i32 = X86_64_SYS_MOUNT;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_UMOUNT2: i32 = X86_64_SYS_UMOUNT2;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_PIVOT_ROOT: i32 = X86_64_SYS_PIVOT_ROOT;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_SWAPON: i32 = X86_64_SYS_SWAPON;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_SWAPOFF: i32 = X86_64_SYS_SWAPOFF;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_USERFAULTFD: i32 = X86_64_SYS_USERFAULTFD;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_BPF: i32 = X86_64_SYS_BPF;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_KEYCTL: i32 = X86_64_SYS_KEYCTL;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_ADD_KEY: i32 = X86_64_SYS_ADD_KEY;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_REQUEST_KEY: i32 = X86_64_SYS_REQUEST_KEY;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_ACCT: i32 = X86_64_SYS_ACCT;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_IOPERM: i32 = X86_64_SYS_IOPERM;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_IOPL: i32 = X86_64_SYS_IOPL;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_INIT_MODULE: i32 = X86_64_SYS_INIT_MODULE;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_DELETE_MODULE: i32 = X86_64_SYS_DELETE_MODULE;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
pub const SYS_FINIT_MODULE: i32 = X86_64_SYS_FINIT_MODULE;

/// Returns the standard high-risk dangerous syscalls for a given audit architecture.
pub fn dangerous_syscalls_for_arch(arch: u32) -> &'static [i32] {
    match arch {
        AUDIT_ARCH_AARCH64 => &[
            AARCH64_SYS_PTRACE,
            AARCH64_SYS_PROCESS_VM_READV,
            AARCH64_SYS_PROCESS_VM_WRITEV,
            AARCH64_SYS_KEXEC_LOAD,
            AARCH64_SYS_KEXEC_FILE_LOAD,
            AARCH64_SYS_REBOOT,
            AARCH64_SYS_MOUNT,
            AARCH64_SYS_UMOUNT2,
            AARCH64_SYS_PIVOT_ROOT,
            AARCH64_SYS_SWAPON,
            AARCH64_SYS_SWAPOFF,
            AARCH64_SYS_USERFAULTFD,
            AARCH64_SYS_BPF,
            AARCH64_SYS_KEYCTL,
            AARCH64_SYS_ADD_KEY,
            AARCH64_SYS_REQUEST_KEY,
            AARCH64_SYS_ACCT,
            AARCH64_SYS_INIT_MODULE,
            AARCH64_SYS_DELETE_MODULE,
            AARCH64_SYS_FINIT_MODULE,
        ],
        AUDIT_ARCH_RISCV64 => &[
            RISCV64_SYS_PTRACE,
            RISCV64_SYS_PROCESS_VM_READV,
            RISCV64_SYS_PROCESS_VM_WRITEV,
            RISCV64_SYS_KEXEC_LOAD,
            RISCV64_SYS_KEXEC_FILE_LOAD,
            RISCV64_SYS_REBOOT,
            RISCV64_SYS_MOUNT,
            RISCV64_SYS_UMOUNT2,
            RISCV64_SYS_PIVOT_ROOT,
            RISCV64_SYS_SWAPON,
            RISCV64_SYS_SWAPOFF,
            RISCV64_SYS_USERFAULTFD,
            RISCV64_SYS_BPF,
            RISCV64_SYS_KEYCTL,
            RISCV64_SYS_ADD_KEY,
            RISCV64_SYS_REQUEST_KEY,
            RISCV64_SYS_ACCT,
            RISCV64_SYS_INIT_MODULE,
            RISCV64_SYS_DELETE_MODULE,
            RISCV64_SYS_FINIT_MODULE,
        ],
        _ => &[
            X86_64_SYS_PTRACE,
            X86_64_SYS_PROCESS_VM_READV,
            X86_64_SYS_PROCESS_VM_WRITEV,
            X86_64_SYS_KEXEC_LOAD,
            X86_64_SYS_KEXEC_FILE_LOAD,
            X86_64_SYS_REBOOT,
            X86_64_SYS_MOUNT,
            X86_64_SYS_UMOUNT2,
            X86_64_SYS_PIVOT_ROOT,
            X86_64_SYS_SWAPON,
            X86_64_SYS_SWAPOFF,
            X86_64_SYS_USERFAULTFD,
            X86_64_SYS_BPF,
            X86_64_SYS_KEYCTL,
            X86_64_SYS_ADD_KEY,
            X86_64_SYS_REQUEST_KEY,
            X86_64_SYS_ACCT,
            X86_64_SYS_IOPERM,
            X86_64_SYS_IOPL,
            X86_64_SYS_INIT_MODULE,
            X86_64_SYS_DELETE_MODULE,
            X86_64_SYS_FINIT_MODULE,
        ],
    }
}

/// Low-level Linux BPF filter instruction.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SockFilter {
    pub code: u16,
    pub jt: u8,
    pub jf: u8,
    pub k: u32,
}

/// Low-level Linux BPF filter program container.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SockFprog {
    pub len: u16,
    pub filter: *const SockFilter,
}

/// Helper to create a non-branching BPF instruction statement.
#[inline]
pub fn bpf_stmt(code: u16, k: u32) -> SockFilter {
    SockFilter {
        code,
        jt: 0,
        jf: 0,
        k,
    }
}

/// Helper to create a conditional branching BPF instruction.
#[inline]
pub fn bpf_jump(code: u16, k: u32, jt: u8, jf: u8) -> SockFilter {
    SockFilter { code, jt, jf, k }
}

/// Seccomp action to take when a filter rule triggers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeccompAction {
    Allow,
    KillProcess,
    KillThread,
    Trap,
    Errno(u16),
    Trace(u16),
    Log,
}

impl SeccompAction {
    /// Encodes the action into its raw Seccomp BPF 32-bit return word.
    pub fn to_ret_code(&self) -> u32 {
        match self {
            SeccompAction::Allow => SECCOMP_RET_ALLOW,
            SeccompAction::KillProcess => SECCOMP_RET_KILL_PROCESS,
            SeccompAction::KillThread => SECCOMP_RET_KILL_THREAD,
            SeccompAction::Trap => SECCOMP_RET_TRAP,
            SeccompAction::Errno(code) => SECCOMP_RET_ERRNO | ((*code as u32) & SECCOMP_RET_DATA),
            SeccompAction::Trace(msg) => SECCOMP_RET_TRACE | ((*msg as u32) & SECCOMP_RET_DATA),
            SeccompAction::Log => SECCOMP_RET_LOG,
        }
    }
}

/// Compiled Seccomp BPF bytecode filter.
#[derive(Debug, Clone)]
pub struct BpfProgram {
    instructions: Vec<SockFilter>,
}

impl BpfProgram {
    /// Creates a BpfProgram from raw filter instructions.
    pub fn new(instructions: Vec<SockFilter>) -> Self {
        Self { instructions }
    }

    /// Returns a slice of the compiled BPF instructions.
    pub fn instructions(&self) -> &[SockFilter] {
        &self.instructions
    }

    /// Returns the number of instructions in the program.
    pub fn len(&self) -> usize {
        self.instructions.len()
    }

    /// Returns true if the program has zero instructions.
    pub fn is_empty(&self) -> bool {
        self.instructions.is_empty()
    }

    /// Enforces the BPF seccomp filter on the calling process and all its descendants.
    pub fn apply(&self) -> Result<(), VettoError> {
        if self.instructions.is_empty() {
            return Err(VettoError::seccomp("cannot apply empty BPF program"));
        }

        if self.instructions.len() > BPF_MAXINSNS {
            return Err(VettoError::BpfCompilationError(format!(
                "BPF program exceeds maximum instruction limit ({})",
                BPF_MAXINSNS
            )));
        }

        prctl_set_no_new_privs()?;

        #[cfg(target_os = "linux")]
        {
            let prog = SockFprog {
                len: self.instructions.len() as u16,
                filter: self.instructions.as_ptr(),
            };

            let res = unsafe {
                libc::prctl(
                    libc::PR_SET_SECCOMP,
                    libc::SECCOMP_MODE_FILTER,
                    &prog as *const SockFprog,
                )
            };

            if res < 0 {
                let err = std::io::Error::last_os_error();
                return Err(VettoError::syscall_failed(
                    err.raw_os_error().unwrap_or(-1),
                    format!("prctl(PR_SET_SECCOMP) failed: {}", err),
                ));
            }

            Ok(())
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err(VettoError::SeccompNotSupported(
                "Seccomp BPF is only supported on Linux".to_string(),
            ))
        }
    }
}

/// Returns the native host audit architecture constant.
pub fn get_native_audit_arch() -> u32 {
    #[cfg(target_arch = "x86_64")]
    {
        AUDIT_ARCH_X86_64
    }
    #[cfg(target_arch = "aarch64")]
    {
        AUDIT_ARCH_AARCH64
    }
    #[cfg(target_arch = "riscv64")]
    {
        AUDIT_ARCH_RISCV64
    }
    #[cfg(target_arch = "x86")]
    {
        AUDIT_ARCH_I386
    }
    #[cfg(target_arch = "arm")]
    {
        AUDIT_ARCH_ARM
    }
    #[cfg(not(any(
        target_arch = "x86_64",
        target_arch = "aarch64",
        target_arch = "riscv64",
        target_arch = "x86",
        target_arch = "arm"
    )))]
    {
        AUDIT_ARCH_X86_64
    }
}

/// Seccomp BPF filter builder for configuring allowed/denied system calls.
#[derive(Debug, Clone)]
pub struct SeccompFilter {
    default_action: SeccompAction,
    rules: BTreeMap<i32, SeccompAction>,
    audit_arch: u32,
}

impl Default for SeccompFilter {
    fn default() -> Self {
        Self::default_allow()
    }
}

impl SeccompFilter {
    /// Creates a new SeccompFilter with the specified default action for unhandled syscalls.
    pub fn new(default_action: SeccompAction) -> Self {
        Self {
            default_action,
            rules: BTreeMap::new(),
            audit_arch: get_native_audit_arch(),
        }
    }

    /// Creates a filter that permits all system calls by default (allowlist mode for denials).
    pub fn default_allow() -> Self {
        Self::new(SeccompAction::Allow)
    }

    /// Creates a filter that denies all system calls by default (strict denylist mode).
    pub fn default_deny() -> Self {
        Self::new(SeccompAction::Errno(libc::EPERM as u16))
    }

    /// Overrides the target architecture for multi-arch filter cross-compilation.
    pub fn with_target_arch(mut self, arch: u32) -> Self {
        self.audit_arch = arch;
        self
    }

    /// Registers a rule to permit a specific system call.
    pub fn allow_syscall(&mut self, syscall_nr: i32) -> Result<&mut Self, VettoError> {
        if syscall_nr < 0 {
            return Err(VettoError::invalid_rule("negative syscall number"));
        }
        self.rules.insert(syscall_nr, SeccompAction::Allow);
        Ok(self)
    }

    /// Registers a rule to deny a specific system call with a custom action.
    pub fn deny_syscall(&mut self, syscall_nr: i32, action: SeccompAction) -> Result<&mut Self, VettoError> {
        if syscall_nr < 0 {
            return Err(VettoError::invalid_rule("negative syscall number"));
        }
        self.rules.insert(syscall_nr, action);
        Ok(self)
    }

    /// Denies a standard list of high-risk security-sensitive syscalls (ptrace, mount, bpf, etc.)
    /// tailored to the configured audit architecture.
    pub fn deny_dangerous_syscalls(&mut self) -> Result<&mut Self, VettoError> {
        let dangerous = dangerous_syscalls_for_arch(self.audit_arch);
        for &nr in dangerous {
            if nr >= 0 {
                self.deny_syscall(nr, SeccompAction::Errno(libc::EPERM as u16))?;
            }
        }

        Ok(self)
    }

    /// Compiles the rules into a verifiable BPF instruction sequence.
    pub fn compile(&self) -> Result<BpfProgram, VettoError> {
        let mut instrs: Vec<SockFilter> = Vec::new();

        // 1. Load architecture from seccomp_data (offset 4)
        instrs.push(bpf_stmt(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_ARCH_OFFSET));

        // 2. Validate architecture matches target_arch: if equal skip 1 (go to load nr), else execute kill
        instrs.push(bpf_jump(
            BPF_JMP | BPF_JEQ | BPF_K,
            self.audit_arch,
            1,
            0,
        ));

        // 3. Architecture mismatch -> Kill process immediately
        instrs.push(bpf_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));

        // 4. Load syscall number from seccomp_data (offset 0)
        instrs.push(bpf_stmt(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_NR_OFFSET));

        // 5. On x86_64, check and block __X32_SYSCALL_BIT (0x40000000)
        if self.audit_arch == AUDIT_ARCH_X86_64 {
            // If syscall_nr >= 0x40000000: jt=0 (execute next instruction: RET KILL_PROCESS)
            // If syscall_nr < 0x40000000: jf=1 (skip next instruction: continue)
            instrs.push(bpf_jump(
                BPF_JMP | BPF_JGE | BPF_K,
                __X32_SYSCALL_BIT,
                0,
                1,
            ));
            instrs.push(bpf_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
        }

        // 6. Emit test and return for each configured rule
        for (&syscall_nr, &action) in &self.rules {
            // If syscall_nr == k: jump 0 (execute next instruction: RET action)
            // If syscall_nr != k: jump 1 (skip next instruction: continue to next check)
            instrs.push(bpf_jump(
                BPF_JMP | BPF_JEQ | BPF_K,
                syscall_nr as u32,
                0,
                1,
            ));
            instrs.push(bpf_stmt(BPF_RET | BPF_K, action.to_ret_code()));
        }

        // 7. Default action if no rule matched
        instrs.push(bpf_stmt(BPF_RET | BPF_K, self.default_action.to_ret_code()));

        if instrs.len() > BPF_MAXINSNS {
            return Err(VettoError::BpfCompilationError(format!(
                "Compiled BPF program exceeds maximum instruction limit ({})",
                BPF_MAXINSNS
            )));
        }

        Ok(BpfProgram::new(instrs))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_seccomp_action_encoding() {
        assert_eq!(SeccompAction::Allow.to_ret_code(), 0x7fff0000);
        assert_eq!(SeccompAction::KillProcess.to_ret_code(), 0x80000000);
        assert_eq!(SeccompAction::Trap.to_ret_code(), 0x00030000);
        assert_eq!(SeccompAction::Errno(1).to_ret_code(), 0x00050001);
        assert_eq!(SeccompAction::Errno(13).to_ret_code(), 0x0005000d);
    }

    #[test]
    fn test_bpf_program_compilation_x86_64() {
        let mut filter = SeccompFilter::default_allow().with_target_arch(AUDIT_ARCH_X86_64);
        filter
            .deny_syscall(X86_64_SYS_PTRACE, SeccompAction::Errno(libc::EPERM as u16))
            .expect("deny ptrace failed");

        let prog = filter.compile().expect("compilation failed");
        let instrs = prog.instructions();

        // Structure on x86_64:
        // 0: LD arch
        // 1: JEQ AUDIT_ARCH_X86_64 jt=1 jf=0
        // 2: RET KILL_PROCESS
        // 3: LD nr
        // 4: JGE 0x40000000 (__X32_SYSCALL_BIT) jt=0 jf=1
        // 5: RET KILL_PROCESS
        // 6: JEQ 101 (SYS_PTRACE) jt=0 jf=1
        // 7: RET ERRNO(EPERM)
        // 8: RET ALLOW
        assert_eq!(instrs.len(), 9);
        assert_eq!(instrs[0].code, BPF_LD | BPF_W | BPF_ABS);
        assert_eq!(instrs[0].k, SECCOMP_DATA_ARCH_OFFSET);
        assert_eq!(instrs[1].k, AUDIT_ARCH_X86_64);
        assert_eq!(instrs[2].k, SECCOMP_RET_KILL_PROCESS);
        assert_eq!(instrs[3].k, SECCOMP_DATA_NR_OFFSET);
        assert_eq!(instrs[4].k, __X32_SYSCALL_BIT);
        assert_eq!(instrs[5].k, SECCOMP_RET_KILL_PROCESS);
        assert_eq!(instrs[6].k, X86_64_SYS_PTRACE as u32);
        assert_eq!(instrs[7].k, SECCOMP_RET_ERRNO | (libc::EPERM as u32));
        assert_eq!(instrs[8].k, SECCOMP_RET_ALLOW);
    }

    #[test]
    fn test_bpf_program_compilation_aarch64() {
        let mut filter = SeccompFilter::default_allow().with_target_arch(AUDIT_ARCH_AARCH64);
        filter
            .deny_syscall(AARCH64_SYS_PTRACE, SeccompAction::Errno(libc::EPERM as u16))
            .expect("deny ptrace failed");

        let prog = filter.compile().expect("compilation failed");
        let instrs = prog.instructions();

        // Structure on AARCH64:
        // 0: LD arch
        // 1: JEQ AUDIT_ARCH_AARCH64 jt=1 jf=0
        // 2: RET KILL_PROCESS
        // 3: LD nr
        // 4: JEQ 117 (AARCH64_SYS_PTRACE) jt=0 jf=1
        // 5: RET ERRNO(EPERM)
        // 6: RET ALLOW
        assert_eq!(instrs.len(), 7);
        assert_eq!(instrs[0].k, SECCOMP_DATA_ARCH_OFFSET);
        assert_eq!(instrs[1].k, AUDIT_ARCH_AARCH64);
        assert_eq!(instrs[2].k, SECCOMP_RET_KILL_PROCESS);
        assert_eq!(instrs[3].k, SECCOMP_DATA_NR_OFFSET);
        assert_eq!(instrs[4].k, 117); // AARCH64 ptrace is 117, not 101!
        assert_eq!(instrs[5].k, SECCOMP_RET_ERRNO | (libc::EPERM as u32));
        assert_eq!(instrs[6].k, SECCOMP_RET_ALLOW);
    }

    #[test]
    fn test_bpf_program_compilation_riscv64() {
        let mut filter = SeccompFilter::default_allow().with_target_arch(AUDIT_ARCH_RISCV64);
        filter
            .deny_syscall(RISCV64_SYS_MOUNT, SeccompAction::Errno(libc::EPERM as u16))
            .expect("deny mount failed");

        let prog = filter.compile().expect("compilation failed");
        let instrs = prog.instructions();

        assert_eq!(instrs.len(), 7);
        assert_eq!(instrs[1].k, AUDIT_ARCH_RISCV64);
        assert_eq!(instrs[4].k, 40); // RISCV64 mount is 40, not 165!
    }

    #[test]
    fn test_deny_dangerous_syscalls_multi_arch() {
        // x86_64
        let mut filter_x86 = SeccompFilter::default_allow().with_target_arch(AUDIT_ARCH_X86_64);
        filter_x86.deny_dangerous_syscalls().expect("deny dangerous failed");
        let prog_x86 = filter_x86.compile().expect("compilation failed");
        assert!(prog_x86.len() > 0 && prog_x86.len() <= BPF_MAXINSNS);

        // aarch64
        let mut filter_arm = SeccompFilter::default_allow().with_target_arch(AUDIT_ARCH_AARCH64);
        filter_arm.deny_dangerous_syscalls().expect("deny dangerous failed");
        let prog_arm = filter_arm.compile().expect("compilation failed");
        assert!(prog_arm.len() > 0 && prog_arm.len() <= BPF_MAXINSNS);

        // riscv64
        let mut filter_riscv = SeccompFilter::default_allow().with_target_arch(AUDIT_ARCH_RISCV64);
        filter_riscv.deny_dangerous_syscalls().expect("deny dangerous failed");
        let prog_riscv = filter_riscv.compile().expect("compilation failed");
        assert!(prog_riscv.len() > 0 && prog_riscv.len() <= BPF_MAXINSNS);
    }

    #[test]
    fn test_negative_syscall_validation() {
        let mut filter = SeccompFilter::default_allow();
        let res = filter.allow_syscall(-1);
        assert!(matches!(res, Err(VettoError::InvalidRule(_))));
    }

    #[test]
    fn test_bpf_max_instructions_limit() {
        let mut filter = SeccompFilter::default_allow();
        for nr in 0..2500 {
            let _ = filter.deny_syscall(nr, SeccompAction::Allow);
        }
        let res = filter.compile();
        assert!(res.is_err());
        assert!(matches!(res.unwrap_err(), VettoError::BpfCompilationError(_)));
    }
}
