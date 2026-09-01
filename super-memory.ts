import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * VETTO СУПЕР-ПАМЯТЬ (SUPER-MEMORY ENGINE)
 * 
 * Назначение:
 * 1. Исключить генерацию случайного кода — Фаза 1 всегда знает ЧТО, ГДЕ, КАК и ЗАЧЕМ писать.
 * 2. Хранит полное дерево архитектуры VETTO, экспортированные символы, историю веток и роадмап.
 * 3. Фаза 3 (Оптимизатор) автоматически обогащает Супер-Память после каждого цикла.
 */

export interface SuperMemoryState {
  version: string;
  lastUpdated: string;
  projectIdentity: {
    name: string;
    coreMission: string;
    securityLevel: string;
    kernelTarget: string;
  };
  architecturalRules: {
    bannedPatterns: string[];
    mandatoryPatterns: string[];
    errorHandling: string;
  };
  codebaseRegistry: {
    crates: Record<string, {
      purpose: string;
      files: string[];
      exportedSymbols: string[];
    }>;
  };
  roadmapMilestones: Array<{
    id: string;
    priority: number;
    title: string;
    targetCrate: string;
    targetFile: string;
    testFile: string;
    description: string;
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
    completedInBranch?: string;
  }>;
  lessonsLearned: string[];
}

const memoryDir = join(process.cwd(), "data", "agent_memory");
const memoryPath = join(memoryDir, "super_memory.json");

mkdirSync(memoryDir, { recursive: true });

const DEFAULT_SUPER_MEMORY: SuperMemoryState = {
  version: "0.2.14",
  lastUpdated: new Date().toISOString(),
  projectIdentity: {
    name: "VETTO",
    coreMission: "Zero-overhead native Linux kernel sandboxing for AI coding agents (Claude Code, Codex, Aider)",
    securityLevel: "Kernel-enforced unprivileged isolation (Zero-Root / Zero-Daemon)",
    kernelTarget: "Linux 5.13+ (Landlock ABI v1-v5) + seccomp-bpf"
  },
  architecturalRules: {
    bannedPatterns: [
      "unwrap()",
      "expect()",
      "panic!()",
      "todo!()",
      "unimplemented!()",
      "unsafe blocks without safety comments",
      "direct println! in library crates"
    ],
    mandatoryPatterns: [
      "Result<T, VettoError> on all fallible operations",
      "prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) before Landlock ruleset activation",
      "#[cfg(test)] unit tests in every module",
      "Landlock ABI feature detection before rule creation",
      "Non-blocking FD handling with close-on-exec (O_CLOEXEC)"
    ],
    errorHandling: "Strict domain enums (VettoError) with std::fmt::Display and std::error::Error implementation"
  },
  codebaseRegistry: {
    crates: {
      "crates/vetto-core": {
        purpose: "Низкоуровневая изоляция ядра Linux (Landlock ABI v1-v5, seccomp BPF, namespaces)",
        files: [
          "src/lib.rs",
          "src/landlock/ruleset.rs",
          "src/landlock/abi_v5.rs",
          "src/seccomp/bpf.rs",
          "src/error.rs"
        ],
        exportedSymbols: [
          "VettoSandbox",
          "VettoScopedRuleset",
          "LandlockAbiVersion",
          "VettoError",
          "apply_landlock_scoped"
        ]
      },
      "crates/vetto-shims": {
        purpose: "PATH-шимы и перехват опасных shell-вызовов (rm -rf, git push --force, curl | sh)",
        files: [
          "src/lib.rs",
          "src/interceptor.rs",
          "src/cache.rs"
        ],
        exportedSymbols: [
          "ShimCache",
          "sanitize_agent_exec_args",
          "is_command_safe"
        ]
      },
      "crates/vetto-cli": {
        purpose: "CLI-интерфейс (vetto run, vetto wrap, vetto audit)",
        files: [
          "src/main.rs",
          "src/cli/args.rs"
        ],
        exportedSymbols: [
          "CliCommand",
          "execute_sandboxed_run"
        ]
      }
    }
  },
  roadmapMilestones: [
    {
      id: "M1_LANDLOCK_ABI5_SCOPING",
      priority: 1,
      title: "Landlock ABI v5 Scoping (Signals & UNIX Sockets)",
      targetCrate: "crates/vetto-core",
      targetFile: "crates/vetto-core/src/landlock/abi_v5_scoping.rs",
      testFile: "crates/vetto-core/tests/test_abi_v5_scoping.rs",
      description: "Изоляция сигналов ptrace и абстрактных unix сокетов для дочерних процессов агентов в Linux 6.12+",
      status: "IN_PROGRESS"
    },
    {
      id: "M2_SHIM_CACHE_CONCURRENCY",
      priority: 2,
      title: "Thread-Safe PATH Shim Cache with RwLock",
      targetCrate: "crates/vetto-shims",
      targetFile: "crates/vetto-shims/src/cache.rs",
      testFile: "crates/vetto-shims/tests/test_cache.rs",
      description: "Потокобезопасный кэш разрешенных бинарников для нулевой задержки перехвата вызовов агента",
      status: "PENDING"
    },
    {
      id: "M3_SECCOMP_SYSCALL_GUARD",
      priority: 3,
      title: "Seccomp BPF Deny-List Filter for Agent Escapes",
      targetCrate: "crates/vetto-core",
      targetFile: "crates/vetto-core/src/seccomp/bpf_guard.rs",
      testFile: "crates/vetto-core/tests/test_seccomp_bpf.rs",
      description: "Запрет сисколов mount, ptrace, unshare, keyctl с действием SECCOMP_RET_KILL",
      status: "PENDING"
    },
    {
      id: "M4_NETWORK_PORT_ISOLATION",
      priority: 4,
      title: "Landlock ABI v4 TCP Port Binding Isolation",
      targetCrate: "crates/vetto-core",
      targetFile: "crates/vetto-core/src/landlock/net_guard.rs",
      testFile: "crates/vetto-core/tests/test_net_guard.rs",
      description: "Блокировка неавторизованных исходящих сокетов и привязок к портам (LANDLOCK_RULE_NET_PORT)",
      status: "PENDING"
    }
  ],
  lessonsLearned: [
    "b.ai шлюз требует Concurrency Pool N=2-3 со сглаживанием 500 мс во избежание сброса сокетов.",
    "Groq LPU идеален для пре-валидации синтаксиса Rust и триажа лидов (45-150 мс).",
    "Nemotron-3 Ultra 550B MoE на OpenCode Zen дает глубочайший анализ monotonic restrictions ядра Linux.",
    "Codestral-22B от NVIDIA лидирует по точности FIM-генерации кода на Rust без паник."
  ]
};

export function loadSuperMemory(): SuperMemoryState {
  if (existsSync(memoryPath)) {
    try {
      const data = JSON.parse(readFileSync(memoryPath, "utf8"));
      return data;
    } catch {
      // fallback
    }
  }
  saveSuperMemory(DEFAULT_SUPER_MEMORY);
  return DEFAULT_SUPER_MEMORY;
}

export function saveSuperMemory(memory: SuperMemoryState): void {
  memory.lastUpdated = new Date().toISOString();
  writeFileSync(memoryPath, JSON.stringify(memory, null, 2), "utf8");
}

/**
 * Получить текущую целевую задачу для Фазы 1 из Роадмапа Супер-Памяти
 */
export function getNextMilestone(memory: SuperMemoryState) {
  const active = memory.roadmapMilestones.find(m => m.status === "IN_PROGRESS") ||
                 memory.roadmapMilestones.find(m => m.status === "PENDING") ||
                 memory.roadmapMilestones[0];
  return active;
}

/**
 * Сформировать компактный архитектурный контекст Супер-Памяти для промптов
 */
export function buildSuperMemoryPromptContext(memory: SuperMemoryState): string {
  const milestone = getNextMilestone(memory);
  return [
    `=== БАЗА ЗНАНИЙ И СУПЕР-ПАМЯТЬ VETTO (Версия ${memory.version}) ===`,
    `1. МИССИЯ: ${memory.projectIdentity.coreMission}`,
    `2. ЖЕСТКИЕ ПРАВИЛА КОДА: Запрещены: ${memory.architecturalRules.bannedPatterns.join(", ")}.`,
    `   Обязательно: ${memory.architecturalRules.mandatoryPatterns.join("; ")}.`,
    `3. ТЕКУЩАЯ ЦЕЛЕВАЯ ЗАДАЧА [${milestone.id}]:`,
    `   • Заголовок: ${milestone.title}`,
    `   • Целевой файл: ${milestone.targetFile}`,
    `   • Файл тестов: ${milestone.testFile}`,
    `   • Описание: ${milestone.description}`,
    `4. СУЩЕСТВУЮЩИЕ КРЕЙТЫ: ${Object.keys(memory.codebaseRegistry.crates).join(", ")}`,
    `5. ЭКСПОРТИРОВАННЫЕ ТИПЫ: ${Object.values(memory.codebaseRegistry.crates).flatMap(c => c.exportedSymbols).join(", ")}`
  ].join("\n");
}

/**
 * Фаза 3: Обновление Супер-Памяти по итогам выполненного цикла
 */
export function updateSuperMemoryAfterCycle(
  branchName: string,
  milestoneId: string,
  newSymbols: string[],
  lesson: string
): SuperMemoryState {
  const memory = loadSuperMemory();
  const target = memory.roadmapMilestones.find(m => m.id === milestoneId);
  if (target) {
    target.status = "COMPLETED";
    target.completedInBranch = branchName;
  }

  // Обновляем следующий milestone в IN_PROGRESS
  const next = memory.roadmapMilestones.find(m => m.status === "PENDING");
  if (next) next.status = "IN_PROGRESS";

  // Добавляем новые экспортированные символы
  if (newSymbols.length > 0 && target) {
    const crate = memory.codebaseRegistry.crates[target.targetCrate];
    if (crate) {
      crate.exportedSymbols = Array.from(new Set([...crate.exportedSymbols, ...newSymbols]));
    }
  }

  // Добавляем инсайт
  if (lesson) {
    memory.lessonsLearned.push(`[${branchName}] ${lesson}`);
    if (memory.lessonsLearned.length > 20) memory.lessonsLearned.shift();
  }

  saveSuperMemory(memory);
  return memory;
}
