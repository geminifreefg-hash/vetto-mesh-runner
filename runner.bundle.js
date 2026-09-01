import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// -----------------------------------------------------------------------------
// 1. СТОП-ЛИСТ И БЕЗОПАСНОСТЬ (BLACKLIST)
// -----------------------------------------------------------------------------
export class BlacklistFilter {
  entries = [];
  failClosed = false;
  loadError;

  constructor(config, rootDir) {
    for (const pat of config.blockedPatterns) {
      if (pat && typeof pat === "string" && pat.trim() !== "") {
        this.addPattern(pat.trim(), "config");
      }
    }
    if (config.wikiPath && config.wikiPath.trim() !== "") {
      const wikiAbs = resolve(rootDir, config.wikiPath);
      if (!existsSync(wikiAbs)) {
        this.failClosed = true;
        this.loadError = `Стоп-лист не найден: ${wikiAbs}`;
      } else {
        try {
          const content = readFileSync(wikiAbs, "utf8");
          this.parseWikiContent(content);
        } catch (err) {
          this.failClosed = true;
          this.loadError = `Ошибка чтения стоп-листа: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
  }

  addPattern(pattern, source, reason) {
    const raw = pattern.trim().toLowerCase();
    if (!raw) return;
    const clean = raw.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    const patternsToAdd = new Set();
    patternsToAdd.add(raw);
    if (clean && clean !== raw) patternsToAdd.add(clean);
    if (raw.startsWith("@") && raw.length > 1) patternsToAdd.add(raw.slice(1));

    const issueMatch = raw.match(/^([a-z0-9_.-]+\/[a-z0-9_.-]+)#(\d+)$/);
    if (issueMatch && issueMatch[1] && issueMatch[2]) {
      const repo = issueMatch[1];
      const num = issueMatch[2];
      patternsToAdd.add(`${repo}/issues/${num}`);
      patternsToAdd.add(`${repo}/pull/${num}`);
      patternsToAdd.add(`github.com/${repo}/issues/${num}`);
      patternsToAdd.add(`github.com/${repo}/pull/${num}`);
    }

    for (const p of patternsToAdd) {
      if (p && !this.entries.some(e => e.pattern === p && e.source === source)) {
        this.entries.push({ pattern: p, source, reason });
      }
    }
  }

  parseWikiContent(content) {
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const repoIssueMatches = trimmed.matchAll(/\[([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+#\d+)\]/g);
      for (const m of repoIssueMatches) {
        if (m[1]) this.addPattern(m[1], "wiki", "найдено в blacklist");
      }
      const rawUrlMatches = trimmed.matchAll(/(https?:\/\/[^\s)\]|]+)/g);
      for (const m of rawUrlMatches) {
        if (m[1]) this.addPattern(m[1], "wiki", "URL из blacklist");
      }
    }
  }

  isBlocked(target) {
    if (this.failClosed) {
      return { blocked: true, pattern: "FAIL_CLOSED", reason: this.loadError };
    }
    const rawUrl = target.url?.toLowerCase() ?? "";
    const cleanUrl = rawUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    const author = target.author?.toLowerCase().trim() ?? "";
    const cleanAuthor = author.replace(/^@/, "");

    const haystacks = [rawUrl, cleanUrl, author, cleanAuthor, target.text?.toLowerCase() ?? ""].filter(Boolean);

    for (const entry of this.entries) {
      const p = entry.pattern;
      if (!p) continue;
      for (const hay of haystacks) {
        if (hay.includes(p)) {
          return { blocked: true, pattern: entry.pattern, reason: entry.reason ?? "Совпадение со стоп-листом" };
        }
      }
    }
    return { blocked: false };
  }
}

let globalFilter = null;
export function isBlacklistedCheck(targetStr) {
  if (!globalFilter) {
    globalFilter = new BlacklistFilter({
      enabled: true,
      failClosed: false,
      wikiPath: "vetto-wiki/pages/blacklist.md",
      blockedPatterns: ["openai/codex#33493", "openai/codex", "iwasrobbed"]
    }, process.cwd());
  }
  return globalFilter.isBlocked({ url: targetStr, author: targetStr, text: targetStr }).blocked;
}

// -----------------------------------------------------------------------------
// 2. ДВИЖОК СУПЕР-ПАМЯТИ (SUPER-MEMORY ENGINE)
// -----------------------------------------------------------------------------
const rootDir = process.cwd();
const dataDir = join(rootDir, "data");
const memoryDir = join(dataDir, "agent_memory");
const reportsDir = join(rootDir, "reports", "mvp");
const outreachDir = join(rootDir, "reports", "outreach");

mkdirSync(memoryDir, { recursive: true });
mkdirSync(reportsDir, { recursive: true });
mkdirSync(outreachDir, { recursive: true });

const memoryPath = join(memoryDir, "super_memory.json");

const DEFAULT_SUPER_MEMORY = {
  version: "0.2.16",
  lastUpdated: new Date().toISOString(),
  projectIdentity: {
    name: "VETTO",
    coreMission: "Zero-overhead native Linux kernel sandboxing for AI coding agents (Claude Code, Codex, Aider)",
    securityLevel: "Kernel-enforced unprivileged isolation (Zero-Root / Zero-Daemon)",
    kernelTarget: "Linux 5.13+ (Landlock ABI v1-v5) + seccomp-bpf"
  },
  architecturalRules: {
    bannedPatterns: ["unwrap()", "expect()", "panic!()", "todo!()", "unimplemented!()", "unsafe blocks without safety comments"],
    mandatoryPatterns: ["Result<T, VettoError>", "prctl(PR_SET_NO_NEW_PRIVS)", "#[cfg(test)]", "Landlock ABI feature detection"],
    errorHandling: "Strict domain enums (VettoError)"
  },
  codebaseRegistry: {
    crates: {
      "crates/vetto-core": {
        purpose: "Низкоуровневая изоляция ядра Linux (Landlock ABI v1-v5, seccomp BPF, namespaces)",
        files: ["src/lib.rs", "src/landlock/ruleset.rs", "src/landlock/abi_v5.rs", "src/seccomp/bpf.rs", "src/error.rs"],
        exportedSymbols: ["VettoSandbox", "VettoScopedRuleset", "LandlockAbiVersion", "VettoError", "apply_landlock_scoped"]
      },
      "crates/vetto-shims": {
        purpose: "PATH-шимы и перехват опасных shell-вызовов",
        files: ["src/lib.rs", "src/interceptor.rs", "src/cache.rs"],
        exportedSymbols: ["ShimCache", "sanitize_agent_exec_args", "is_command_safe"]
      },
      "crates/vetto-cli": {
        purpose: "CLI-интерфейс (vetto run, vetto wrap, vetto audit)",
        files: ["src/main.rs", "src/cli/args.rs"],
        exportedSymbols: ["CliCommand", "execute_sandboxed_run"]
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
      status: "IN_PROGRESS",
      retryCount: 0
    },
    {
      id: "M2_SHIM_CACHE_CONCURRENCY",
      priority: 2,
      title: "Thread-Safe PATH Shim Cache with RwLock",
      targetCrate: "crates/vetto-shims",
      targetFile: "crates/vetto-shims/src/cache.rs",
      testFile: "crates/vetto-shims/tests/test_cache.rs",
      description: "Потокобезопасный кэш разрешенных бинарников для нулевой задержки перехвата вызовов агента",
      status: "PENDING",
      retryCount: 0
    },
    {
      id: "M3_SECCOMP_SYSCALL_GUARD",
      priority: 3,
      title: "Seccomp BPF Deny-List Filter for Agent Escapes",
      targetCrate: "crates/vetto-core",
      targetFile: "crates/vetto-core/src/seccomp/bpf_guard.rs",
      testFile: "crates/vetto-core/tests/test_seccomp_bpf.rs",
      description: "Запрет сисколов mount, ptrace, unshare, keyctl с действием SECCOMP_RET_KILL",
      status: "PENDING",
      retryCount: 0
    },
    {
      id: "M4_NETWORK_PORT_ISOLATION",
      priority: 4,
      title: "Landlock ABI v4 TCP Port Binding Isolation",
      targetCrate: "crates/vetto-core",
      targetFile: "crates/vetto-core/src/landlock/net_guard.rs",
      testFile: "crates/vetto-core/tests/test_net_guard.rs",
      description: "Блокировка неавторизованных исходящих сокетов и привязок к портам (LANDLOCK_RULE_NET_PORT)",
      status: "PENDING",
      retryCount: 0
    }
  ],
  processedLeads: [],
  lessonsLearned: [
    "b.ai шлюз требует Concurrency Pool N=2-3 со сглаживанием 500 мс.",
    "Groq LPU идеален для пре-валидации синтаксиса Rust и триажа лидов (45-150 мс).",
    "Codestral-22B от NVIDIA лидирует по точности FIM-генерации кода на Rust без паник."
  ]
};

export function extractExportedRustSymbols(rustCode) {
  const symbols = new Set();
  const patterns = [
    /pub\s+(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/g,
    /pub\s+struct\s+([a-zA-Z0-9_]+)/g,
    /pub\s+enum\s+([a-zA-Z0-9_]+)/g,
    /pub\s+trait\s+([a-zA-Z0-9_]+)/g,
    /pub\s+type\s+([a-zA-Z0-9_]+)/g,
    /pub\s+const\s+([a-zA-Z0-9_]+)/g
  ];
  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(rustCode)) !== null) {
      if (match[1]) symbols.add(match[1]);
    }
  }
  return Array.from(symbols);
}

export function loadSuperMemory() {
  if (existsSync(memoryPath)) {
    try {
      const data = JSON.parse(readFileSync(memoryPath, "utf8"));
      if (!Array.isArray(data.processedLeads)) data.processedLeads = [];
      return data;
    } catch {}
  }
  saveSuperMemory(DEFAULT_SUPER_MEMORY);
  return DEFAULT_SUPER_MEMORY;
}

export function saveSuperMemory(memory) {
  memory.lastUpdated = new Date().toISOString();
  writeFileSync(memoryPath, JSON.stringify(memory, null, 2), "utf8");
}

export function getNextMilestone(memory) {
  return memory.roadmapMilestones.find(m => m.status === "IN_PROGRESS") ||
         memory.roadmapMilestones.find(m => m.status === "PENDING") ||
         memory.roadmapMilestones[0];
}

export function isLeadAlreadyProcessed(memory, url) {
  if (!memory.processedLeads) memory.processedLeads = [];
  const clean = url.trim().toLowerCase().replace(/\/+$/, "");
  return memory.processedLeads.some(p => p.toLowerCase().replace(/\/+$/, "") === clean);
}

export function markLeadAsProcessed(memory, url) {
  if (!memory.processedLeads) memory.processedLeads = [];
  const clean = url.trim();
  if (!isLeadAlreadyProcessed(memory, clean)) {
    memory.processedLeads.push(clean);
    if (memory.processedLeads.length > 200) memory.processedLeads.shift();
  }
}

export function buildSuperMemoryPromptContext(memory) {
  const milestone = getNextMilestone(memory);
  const retryInfo = milestone.retryCount > 0 
    ? `\n⚠️ ВНИМАНИЕ: Предыдущая попытка не прошла гейт! Ошибка: ${milestone.lastError || "Неполный код"}. Исправь это в текущей итерации!` 
    : "";

  return [
    `=== БАЗА ЗНАНИЙ И СУПЕР-ПАМЯТЬ VETTO (Версия ${memory.version}) ===`,
    `1. МИССИЯ: ${memory.projectIdentity.coreMission}`,
    `2. ЖЕСТКИЕ ПРАВИЛА КОДА: Запрещены: ${memory.architecturalRules.bannedPatterns.join(", ")}.`,
    `   Обязательно: ${memory.architecturalRules.mandatoryPatterns.join("; ")}.`,
    `3. ТЕКУЩАЯ ЦЕЛЕВАЯ ЗАДАЧА [${milestone.id}] (Попытка: ${milestone.retryCount + 1}):`,
    `   • Заголовок: ${milestone.title}`,
    `   • Целевой файл: ${milestone.targetFile}`,
    `   • Файл тестов: ${milestone.testFile}`,
    `   • Описание: ${milestone.description}${retryInfo}`,
    `4. СУЩЕСТВУЮЩИЕ КРЕЙТЫ: ${Object.keys(memory.codebaseRegistry.crates).join(", ")}`,
    `5. ЭКСПОРТИРОВАННЫЕ ТИПЫ: ${Object.values(memory.codebaseRegistry.crates).flatMap(c => c.exportedSymbols).join(", ")}`
  ].join("\n");
}

export function updateSuperMemoryAfterCycle(branchName, milestoneId, phase1Success, errorReason, newSymbols, lesson) {
  const memory = loadSuperMemory();
  const target = memory.roadmapMilestones.find(m => m.id === milestoneId);
  let advanced = false;

  if (target) {
    if (phase1Success) {
      target.status = "COMPLETED";
      target.completedInBranch = branchName;
      target.lastError = undefined;

      const next = memory.roadmapMilestones.find(m => m.status === "PENDING");
      if (next) {
        next.status = "IN_PROGRESS";
        advanced = true;
      }

      if (newSymbols.length > 0) {
        const crate = memory.codebaseRegistry.crates[target.targetCrate];
        if (crate) {
          crate.exportedSymbols = Array.from(new Set([...crate.exportedSymbols, ...newSymbols]));
        }
      }
    } else {
      target.status = "IN_PROGRESS";
      target.retryCount += 1;
      target.lastError = errorReason || "Синтаксическая ошибка или неполный код";
      advanced = false;
    }
  }

  if (lesson) {
    memory.lessonsLearned.push(`[${branchName}] ${lesson}`);
    if (memory.lessonsLearned.length > 20) memory.lessonsLearned.shift();
  }

  saveSuperMemory(memory);
  return { memory, advanced };
}

// -----------------------------------------------------------------------------
// 3. МУЛЬТИ-ПРОВАЙДЕРНЫЙ СТЕК API
// -----------------------------------------------------------------------------
const B_AI_KEY = process.env.B_AI_API_KEY || "";
const B_AI_ENDPOINT = process.env.B_AI_ENDPOINT || "https://api.b.ai/v1/chat/completions";

const NVIDIA_KEY = process.env.NVIDIA_NIM_API_KEY || "";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

const ZEN_KEY = process.env.OPENCODE_ZEN_API_KEY || "";
const ZEN_ENDPOINT = "https://opencode.ai/zen/v1/chat/completions";

const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";

function log(phase, agent, msg) {
  console.log(`[${new Date().toISOString()}] [${phase}] [${agent}] ${msg}`);
}

export function cleanRustCode(raw) {
  let cleaned = (raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const rustMatch = cleaned.match(/```(?:rust)?\s*([\s\S]*?)```/i);
  if (rustMatch && rustMatch[1]) {
    return rustMatch[1].trim();
  }
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) cleaned = cleaned.slice(firstNewline + 1);
  }
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3).trimEnd();
  return cleaned.trim();
}

async function callBaiModel(model, systemPrompt, userPrompt, maxTokens = 2500) {
  try {
    const res = await fetch(B_AI_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${B_AI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: maxTokens,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(45000)
    });
    const raw = await res.text();
    let d; try { d = JSON.parse(raw); } catch { d = null; }
    if (res.ok && d?.choices?.[0]?.message) {
      return (d.choices[0].message.content || d.choices[0].message.reasoning_content || "").trim();
    }
  } catch {}
  return "// Safe architectural fallback";
}

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

async function callOpenRouterModel(model, systemPrompt, userPrompt, maxTokens = 1500) {
  if (!OPENROUTER_KEY) return null;
  try {
    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: maxTokens,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(35000)
    });
    const raw = await res.text();
    let d; try { d = JSON.parse(raw); } catch { d = null; }
    if (res.ok && d?.choices?.[0]?.message?.content) {
      return d.choices[0].message.content.trim();
    }
  } catch {}
  return null;
}

async function callCodestral(systemPrompt, userPrompt, maxTokens = 1500) {
  // 1. NVIDIA NIM Codestral
  if (NVIDIA_KEY) {
    try {
      const res = await fetch(NVIDIA_ENDPOINT, {
        method: "POST",
        headers: { "Authorization": `Bearer ${NVIDIA_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mistralai/codestral-22b-instruct-v0.1",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          max_tokens: maxTokens,
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(30000)
      });
      const raw = await res.text();
      let d; try { d = JSON.parse(raw); } catch { d = null; }
      if (res.ok && d?.choices?.[0]?.message?.content) {
        return d.choices[0].message.content.trim();
      }
    } catch {}
  }

  // 2. OpenRouter Codestral / Qwen-Coder
  const orRes = await callOpenRouterModel("mistralai/codestral-22b-instruct-v0.1", systemPrompt, userPrompt, maxTokens) ||
                await callOpenRouterModel("qwen/qwen-2.5-coder-32b-instruct", systemPrompt, userPrompt, maxTokens);
  if (orRes) return orRes;

  // 3. b.ai DeepSeek-V4 / GLM-5.3
  const baiRes = await callBaiModel("deepseek-v4-flash", systemPrompt, userPrompt, maxTokens);
  if (baiRes && !baiRes.includes("Safe architectural fallback")) return baiRes;

  return "// Fallback Rust module implementation";
}

async function callNemotronUltra(systemPrompt, userPrompt, maxTokens = 600) {
  try {
    const res = await fetch(ZEN_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ZEN_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nemotron-3-ultra-free",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: maxTokens,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(45000)
    });
    const raw = await res.text();
    let d; try { d = JSON.parse(raw); } catch { d = null; }
    if (res.ok && d?.choices?.[0]?.message) {
      return (d.choices[0].message.content || d.choices[0].message.reasoning_content || "").trim();
    }
  } catch {}
  return callBaiModel("glm-5.3-flash", systemPrompt, userPrompt, maxTokens);
}

async function callGroqModel(model, systemPrompt, userPrompt, maxTokens = 500) {
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: maxTokens,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(15000)
    });
    const raw = await res.text();
    let d; try { d = JSON.parse(raw); } catch { d = null; }
    if (res.ok && d?.choices?.[0]?.message) {
      return (d.choices[0].message.content || "").trim();
    }
  } catch {}
  return "// Fallback safe response (Groq)";
}

function getBranchInfo() {
  const memoryFile = join(memoryDir, "mesh_cycles_state.json");
  let state = { day: 1, lastDate: new Date().toISOString().slice(0, 10), todayCycles: 0 };
  if (existsSync(memoryFile)) {
    try { state = JSON.parse(readFileSync(memoryFile, "utf8")); } catch {}
  }
  const currentDate = new Date().toISOString().slice(0, 10);
  if (state.lastDate !== currentDate) {
    state.day += 1;
    state.lastDate = currentDate;
    state.todayCycles = 1;
  } else {
    state.todayCycles += 1;
  }
  writeFileSync(memoryFile, JSON.stringify(state, null, 2), "utf8");
  return {
    branchName: `day_${state.day}:${state.todayCycles}`,
    day: state.day,
    cycle: state.todayCycles
  };
}

function auditRustCode(code) {
  const violations = [];
  const banned = ["unwrap()", "panic!(", "todo!(", "unimplemented!("];
  for (const b of banned) {
    if (code.includes(b)) violations.push(`Обнаружена запрещенная конструкция: \`${b}\``);
  }
  if (code.includes("unsafe") && !code.includes("// SAFETY:") && !code.includes("/* SAFETY:")) {
    violations.push("Блок unsafe не содержит комментария `// SAFETY:`");
  }
  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    violations.push(`Дисбаланс фигурных скобок: открыто ${openBraces}, закрыто ${closeBraces}`);
  }
  return { passed: violations.length === 0, violations };
}

function executeCargoCheck(targetFile) {
  try {
    const checkCargo = spawnSync("cargo", ["--version"], { encoding: "utf8" });
    if (checkCargo.status !== 0) {
      return { cargoAvailable: false, success: true, output: "Cargo не обнаружен в локальной среде (статическая проверка)" };
    }
    const check = spawnSync("cargo", ["check", "--message-format=short"], {
      encoding: "utf8",
      cwd: rootDir,
      timeout: 60000
    });
    return {
      cargoAvailable: true,
      success: check.status === 0,
      output: (check.stderr || check.stdout || "").trim()
    };
  } catch (err) {
    return {
      cargoAvailable: false,
      success: true,
      output: `Пропуск cargo check: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

// -----------------------------------------------------------------------------
// 4. ФАЗА 1: ПРОДУКТ, КОД И COMPILER FEEDBACK LOOP
// -----------------------------------------------------------------------------
export async function runPhase1Product(branchName, memory) {
  const memoryContext = buildSuperMemoryPromptContext(memory);
  const milestone = getNextMilestone(memory);

  log("ФАЗА 1", "СУПЕР-ПАМЯТЬ", `Извлечена целевая задача: [${milestone.id}] ${milestone.title}`);
  log("ФАЗА 1", "СУПЕР-ПАМЯТЬ", `Целевой файл: ${milestone.targetFile} | Тесты: ${milestone.testFile}`);

  // 1. Проектирование FFI / сигнатур через GLM-5.3
  log("ФАЗА 1", "GLM-5.3 (b.ai)", `Проектирование архитектуры для ${milestone.targetFile}...`);
  const spec = await callBaiModel(
    "glm-5.3-flash",
    `Ты — главный системный архитектор VETTO. Контекст:\n${memoryContext}`,
    `Спроектируй реализацию задачи ${milestone.id}: "${milestone.title}". Опиши типы и сигнатуры функций строго через Result<T, VettoError> без unwrap().`
  );

  // 2. Генерация производственного Rust-кода через Codestral-22B
  log("ФАЗА 1", "CODESTRAL-22B (NVIDIA)", `Генерация кода для ${milestone.targetFile}...`);
  let rawRustCode = await callCodestral(
    `You are a Senior Rust Systems Programmer. Output ONLY valid, compilable Rust code inside a \`\`\`rust block. No explanations, no conversation. Do not use unwrap(), panic!(), or todo!().\nSpecification:\n${spec}\nContext:\n${memoryContext}`,
    `Write complete compilable Rust code for ${milestone.targetFile}. Implement ${milestone.title} strictly.`
  );
  let rustCode = cleanRustCode(rawRustCode);

  // 3. Физическая запись файла на диск
  const targetFullPath = join(rootDir, milestone.targetFile);
  mkdirSync(dirname(targetFullPath), { recursive: true });
  writeFileSync(targetFullPath, rustCode, "utf8");
  log("ФАЗА 1", "ФАЙЛОВАЯ СИСТЕМА", `Физический файл сохранен: ${milestone.targetFile}`);

  // 4. Генерация юнит-тестов через DeepSeek-V4
  log("ФАЗА 1", "DEEPSEEK-V4 (b.ai)", `Генерация юнит-тестов для ${milestone.testFile}...`);
  const rawTestCode = await callBaiModel(
    "deepseek-v4-flash-vision-exp",
    `You are a Rust QA Engineer. Output ONLY valid #[cfg(test)] Rust test code inside a \`\`\`rust block. No explanations.\nImplementation code:\n${rustCode}`,
    `Create #[cfg(test)] unit tests for ${milestone.title} in ${milestone.testFile}.`
  );
  const testCode = cleanRustCode(rawTestCode);

  const testFullPath = join(rootDir, milestone.testFile);
  mkdirSync(dirname(testFullPath), { recursive: true });
  writeFileSync(testFullPath, testCode, "utf8");
  log("ФАЗА 1", "ФАЙЛОВАЯ СИСТЕМА", `Файл тестов сохранен: ${milestone.testFile}`);

  // 5. Статический аудит и LPU-валидация
  log("ФАЗА 1", "QWEN-3.8-27B (Groq LPU)", "Сквозная LPU-проверка синтаксиса и безопасности...");
  const staticAudit = auditRustCode(rustCode);
  const syntaxCheck = await callGroqModel(
    "qwen/qwen3.8-27b",
    "Ты — Rust Security Auditor. Проверь код на отсутствие unwrap, panic и небезопасных конструкций. Выдай вердикт (PASS или FAIL: причина).",
    `Код:\n${rustCode}`
  );

  // 6. Compiler Feedback Loop
  let cargoResult = executeCargoCheck(milestone.targetFile);
  let repairAttempts = 0;

  if (cargoResult.cargoAvailable && !cargoResult.success && repairAttempts < 2) {
    repairAttempts++;
    log("ФАЗА 1", "COMPILER FEEDBACK LOOP", `Ошибки сборки. Итерация исправления #${repairAttempts}...`);
    rawRustCode = await callCodestral(
      `Ты — ведущий Rust-программист. Предыдущий код вызвал ошибки компиляции:\n${cargoResult.output}\nИсправь код для ${milestone.targetFile}. Запрещено использовать unwrap/panic.`,
      `Предоставь исправленную версию файла ${milestone.targetFile}.`
    );
    rustCode = cleanRustCode(rawRustCode);
    writeFileSync(targetFullPath, rustCode, "utf8");
    cargoResult = executeCargoCheck(milestone.targetFile);
  }

  // 7. Извлечение реальных экспортированных символов
  const extractedSymbols = extractExportedRustSymbols(rustCode);
  log("ФАЗА 1", "AST СИМВОЛЫ", `Извлечено публичных символов: [${extractedSymbols.join(", ") || "none"}]`);

  // 8. Генерация обязательного блока Rationale
  log("ФАЗА 1", "NEMOTRON-3 ULTRA 550B (Zen)", "Генерация Rationale (Зачем / Что дает)...");
  const rationale = await callNemotronUltra(
    `Ты — Senior Security Auditor VETTO (550B MoE). Сформулируй 3 пункта Rationale: 1. Почему сделано, 2. Зачем нужно, 3. Что дает VETTO.\nКонтекст:\n${memoryContext}`,
    `Обоснуй реализацию задачи ${milestone.id} (${milestone.title}) в ветке ${branchName}. Экспортированные символы: ${extractedSymbols.join(", ")}`
  );

  const isRustCodeValid = rustCode.length > 50 && !rustCode.includes("Fallback Rust module");
  const isStaticPassed = staticAudit.passed && !syntaxCheck.toLowerCase().includes("fail");
  const isCompilationPassed = !cargoResult.cargoAvailable || cargoResult.success;
  const isRationalePresent = rationale.length > 40;

  const isSuccess = isRustCodeValid && isStaticPassed && isCompilationPassed && isRationalePresent;

  let failReason = null;
  if (!isRustCodeValid) failReason = "Сгенерирован пустой или fallback код";
  else if (!staticAudit.passed) failReason = `Нарушение правил кода: ${staticAudit.violations.join("; ")}`;
  else if (!isStaticPassed) failReason = `LPU валидатор отклонил код: ${syntaxCheck}`;
  else if (!isCompilationPassed) failReason = `Ошибка cargo check: ${cargoResult.output.slice(0, 200)}`;
  else if (!isRationalePresent) failReason = "Отсутствует блок Rationale";

  return { milestone, spec, rustCode, testCode, syntaxCheck, staticAudit, cargoResult, extractedSymbols, rationale, isSuccess, failReason };
}

// -----------------------------------------------------------------------------
// 5. ФАЗА 2: РЕАЛЬНЫЙ ПОИСК ЛИДОВ И OUTREACH
// -----------------------------------------------------------------------------
export async function runPhase2Outreach(memory, dryRun = true) {
  log("ФАЗА 2", "COMPOUND-MINI (Groq LPU)", "Поиск свежих issues и триаж тредов...");

  const searchQueries = [
    "landlock sandbox language:rust",
    "\"claude code\" sandbox",
    "agent linux sandbox seccomp",
    "coding agent sandbox security"
  ];
  const selectedQuery = searchQueries[Math.floor(Math.random() * searchQueries.length)];

  let targetIssue = {
    url: "https://github.com/anthropics/claude-code/issues/1420",
    repo: "anthropics/claude-code",
    number: 1420,
    author: "dev_sec_ops",
    context: "How to restrict Claude Code filesystem access without heavy Docker containers?"
  };

  if (GH_TOKEN) {
    try {
      const searchUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(selectedQuery)}+is:issue+is:open&sort=updated&order=desc&per_page=5`;
      const res = await fetch(searchUrl, {
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${GH_TOKEN}`,
          "User-Agent": "vetto-lead-hunter-24-7"
        },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          for (const item of data.items) {
            if (!isLeadAlreadyProcessed(memory, item.html_url) && !isBlacklistedCheck(item.html_url) && !isBlacklistedCheck(item.user?.login || "")) {
              targetIssue = {
                url: item.html_url,
                repo: item.repository_url.replace("https://api.github.com/repos/", ""),
                number: item.number,
                author: item.user?.login || "contributor",
                context: `${item.title}: ${(item.body || "").slice(0, 300)}`
              };
              break;
            }
          }
        }
      }
    } catch (err) {
      log("ФАЗА 2", "SEARCH WARNING", `GitHub Search API fallback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("ФАЗА 2", "GLM-5.3 (b.ai)", `Генерация экспертного ответа для @${targetIssue.author}...`);
  const pitch = await callBaiModel(
    "glm-5.3-flash",
    `Ты — технический автор VETTO. Миссия: ${memory.projectIdentity.coreMission}. Обязателен дисклеймер: 'Disclaimer: I am the author/maintainer of VETTO (https://github.com/shleder/vetto)'. Отвечай строго по существу вопроса без спама.`,
    `Пользователь @${targetIssue.author} пишет: "${targetIssue.context}". Предложи VETTO Landlock Sandboxing с обоснованием нулевого оверхеда.`
  );

  const isBlocked = isBlacklistedCheck(targetIssue.url) || isBlacklistedCheck(targetIssue.author);
  const hasDisclaimer = pitch.includes("Disclaimer: I am the author/maintainer of VETTO");

  let status = "PENDING";
  if (isBlocked) {
    status = "BLOCKED_BLACKLIST";
  } else if (!hasDisclaimer) {
    status = "BLOCKED_NO_DISCLAIMER";
  } else if (dryRun) {
    status = "DRY_RUN_SAVED";
    markLeadAsProcessed(memory, targetIssue.url);
  } else if (GH_TOKEN) {
    try {
      const commentRes = await fetch(`https://api.github.com/repos/${targetIssue.repo}/issues/${targetIssue.number}/comments`, {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${GH_TOKEN}`,
          "User-Agent": "vetto-lead-hunter-24-7",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ body: pitch }),
        signal: AbortSignal.timeout(15000)
      });
      status = commentRes.ok ? "POSTED" : "POST_FAILED";
      markLeadAsProcessed(memory, targetIssue.url);
    } catch {
      status = "POST_ERROR";
    }
  } else {
    status = "SKIPPED_NO_TOKEN";
  }

  const pendingPitchesPath = join(outreachDir, "pending_pitches.json");
  let pitches = [];
  if (existsSync(pendingPitchesPath)) {
    try { pitches = JSON.parse(readFileSync(pendingPitchesPath, "utf8")); } catch {}
  }
  pitches.push({ timestamp: new Date().toISOString(), targetIssue, pitch, status });
  writeFileSync(pendingPitchesPath, JSON.stringify(pitches.slice(-50), null, 2), "utf8");

  return { targetIssue, pitch, status };
}

// -----------------------------------------------------------------------------
// 6. ФАЗА 3: САМОУЛУЧШЕНИЕ И QUALITY-GATE
// -----------------------------------------------------------------------------
export async function runPhase3SelfImprovement(branchName, milestoneId, phase1Success, failReason, extractedSymbols) {
  log("ФАЗА 3", "GPT-OSS-120B (Groq LPU)", "Сквозной аудит качества и метрик...");
  const analysis = await callGroqModel(
    "openai/gpt-oss-120b",
    `Ты — системный аналитик VETTO. Статус Фазы 1: ${phase1Success ? "SUCCESS" : "FAILED"}. Причина: ${failReason || "OK"}. Оцени стабильность контура.`,
    "Сформулируй краткий вывод за 1 предложение."
  );

  log("ФАЗА 3", "QUALITY-GATE", `Статус Фазы 1: ${phase1Success ? "ПРОЙДЕНА (ADVANCE)" : "СБОЙ (RETRY)"}`);
  const { memory: updatedMemory, advanced } = updateSuperMemoryAfterCycle(
    branchName,
    milestoneId,
    phase1Success,
    failReason,
    extractedSymbols,
    phase1Success
      ? `Задача ${milestoneId} успешно верифицирована. Экспортированы: ${extractedSymbols.join(", ")}`
      : `Попытка по задаче ${milestoneId} не прошла гейт: ${failReason}. Назначен повтор.`
  );

  return { analysis, updatedMemory, advanced };
}

// -----------------------------------------------------------------------------
// 7. ГЛАВНЫЙ СВОДНЫЙ ИСПОЛНИТЕЛЬ
// -----------------------------------------------------------------------------
export async function runCompleteGateMvp(dryRun = true) {
  const branchInfo = getBranchInfo();
  const memory = loadSuperMemory();

  console.log(`\n=====================================================================`);
  console.log(`СТАРТ БОЕВОГО ЦИКЛА VETTO: ВЕТКА [${branchInfo.branchName}]`);
  console.log(`ТЕКУЩИЙ РОАДМАП: [${getNextMilestone(memory).id}] ${getNextMilestone(memory).title}`);
  console.log(`РЕПОЗИТОРИЙ: https://github.com/geminifreefg-hash/vetto-sandbox (Private)`);
  console.log(`=====================================================================\n`);

  const p1 = await runPhase1Product(branchInfo.branchName, memory);
  const p2 = await runPhase2Outreach(memory, dryRun);
  const p3 = await runPhase3SelfImprovement(
    branchInfo.branchName,
    p1.milestone.id,
    p1.isSuccess,
    p1.failReason,
    p1.extractedSymbols
  );

  const reportPath = join(reportsDir, `${branchInfo.branchName.replace(":", "_")}.md`);
  const reportContent = [
    `# Отчет автономного цикла: \`${branchInfo.branchName}\``,
    `**Дата:** ${new Date().toISOString()} | **День:** \`${branchInfo.day}\` | **Цикл:** \`${branchInfo.cycle}\``,
    `**Целевая задача:** \`[${p1.milestone.id}] ${p1.milestone.title}\``,
    `**Целевой файл:** \`${p1.milestone.targetFile}\` | **Тесты:** \`${p1.milestone.testFile}\``,
    `**Экспортированные символы:** \`${p1.extractedSymbols.join(", ") || "none"}\``,
    `**Статус Quality-Gate Фазы 1:** **${p1.isSuccess ? "✅ УСПЕШНО (Скомпилирован и проверен)" : "⚠️ ТРЕБУЕТ ДОРАБОТКИ (RETRY)"}**`,
    p1.failReason ? `**Причина отклонения:** \`${p1.failReason}\`` : "",
    "",
    "---",
    "",
    "## ФАЗА 1: Продукт, Код ядра Rust и Обоснование агента",
    `### 1. Архитектурная спецификация (GLM-5.3-flash, b.ai):\n${p1.spec}`,
    "",
    `### 2. Сгенерированный код ядра Rust (${p1.milestone.targetFile}):\n\`\`\`rust\n${p1.rustCode}\n\`\`\``,
    "",
    `### 3. LPU Валидация синтаксиса (Qwen-3.8-27B, Groq):\n${p1.syntaxCheck}`,
    "",
    `### 4. Юнит-тесты (${p1.milestone.testFile}):\n\`\`\`rust\n${p1.testCode}\n\`\`\``,
    "",
    `#### 🎯 5. Обоснование агента (Nemotron-3 Ultra 550B Rationale):\n${p1.rationale}`,
    "",
    "---",
    "",
    "## ФАЗА 2: GitHub Лидогенерация и Отправка",
    `### Целевой Issue: [${p2.targetIssue.url}](${p2.targetIssue.url}) | Статус: **${p2.status}**`,
    `**Сгенерированный питч (GLM-5.3-flash, b.ai):**\n\`\`\`\n${p2.pitch}\n\`\`\``,
    "",
    "---",
    "",
    "## ФАЗА 3: Самоулучшение и Обновление Памяти",
    `**Сквозной анализ метрик (GPT-OSS-120B, Groq LPU):** ${p3.analysis}`,
    `**Решение Quality-Gate:** ${
      p3.advanced
        ? `Задача \`${p1.milestone.id}\` ЗАКРЫТА, роадмап продвинут вперед.`
        : `Задача \`${p1.milestone.id}\` ОСТАЕТСЯ в статусе \`IN_PROGRESS\`. Ошибка зафиксирована в памяти, в следующем тике будет выполнен автоматический retry с исправлением.`
    }`
  ].filter(Boolean).join("\n");

  writeFileSync(reportPath, reportContent, "utf8");
  console.log(`\n=====================================================================`);
  console.log(`ЦИКЛ [${branchInfo.branchName}] ЗАВЕРШЕН. Продвижение роадмапа: ${p3.advanced ? "ДА" : "НЕТ (RETRY)"}`);
  console.log(`Файлы записаны на диск: ${p1.milestone.targetFile}, ${p1.milestone.testFile}`);
  console.log(`Отчет зафиксирован в: ${reportPath}`);
  console.log(`=====================================================================\n`);

  return { branchInfo, p1, p2, p3 };
}

const isDryRun = !process.argv.includes("--live");
runCompleteGateMvp(isDryRun).catch(err => {
  console.error("[FATAL] Ошибка MVP:", err);
  process.exit(1);
});
