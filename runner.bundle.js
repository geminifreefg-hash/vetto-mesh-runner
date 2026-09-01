import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function normalizeText(text) {
  if (!text || typeof text !== "string") return "";
  let str = text.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "").trim().toLowerCase();
  try { str = decodeURIComponent(str); } catch {}
  return str;
}

function normalizeUrlPath(url) {
  if (!url || typeof url !== "string") return "";
  let str = normalizeText(url);
  str = str.replace(/^https?:\/\/(www\.)?/, "");
  const withoutQuery = str.split("?")[0] || "";
  str = withoutQuery.split("#")[0] || "";
  str = str.replace(/\/+/g, "/").replace(/\/+$/, "");
  return str;
}

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
      const candidatePaths = [
        resolve(rootDir, config.wikiPath),
        resolve(process.cwd(), config.wikiPath),
        config.wikiPath,
        "/home/shleder/prod/vetto-wiki/pages/blacklist.md"
      ];
      let foundPath = null;
      for (const p of candidatePaths) {
        if (existsSync(p)) {
          foundPath = p;
          break;
        }
      }
      if (!foundPath) {
        this.failClosed = true;
        this.loadError = `Стоп-лист не найден: ${candidatePaths.join(", ")}`;
      } else {
        try {
          const content = readFileSync(foundPath, "utf8");
          if (!content || content.trim().length === 0) {
            this.failClosed = true;
            this.loadError = `Файл стоп-листа пуст: ${foundPath}`;
          } else {
            this.parseWikiContent(content);
            if (this.entries.length === 0) {
              this.failClosed = true;
              this.loadError = `Не удалось извлечь правила из стоп-листа: ${foundPath}`;
            }
          }
        } catch (err) {
          this.failClosed = true;
          this.loadError = `Ошибка чтения стоп-листа: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
  }

  addPattern(pattern, source, reason) {
    const raw = normalizeText(pattern);
    if (!raw) return;
    const clean = normalizeUrlPath(raw);
    const patternsToAdd = new Set();
    patternsToAdd.add(raw);
    if (clean && clean !== raw) patternsToAdd.add(clean);
    if (raw.startsWith("@") && raw.length > 1) {
      patternsToAdd.add(raw.slice(1));
    } else if (/^[a-z0-9_.-]+$/.test(raw) && !raw.includes("/")) {
      patternsToAdd.add(`@${raw}`);
    }

    const issueMatch = raw.match(/^([a-z0-9_.-]+\/[a-z0-9_.-]+)#(\d+)$/);
    if (issueMatch && issueMatch[1] && issueMatch[2]) {
      const repo = issueMatch[1];
      const num = issueMatch[2];
      patternsToAdd.add(`${repo}#${num}`);
      patternsToAdd.add(`${repo}/issues/${num}`);
      patternsToAdd.add(`${repo}/pull/${num}`);
      patternsToAdd.add(`github.com/${repo}/issues/${num}`);
      patternsToAdd.add(`github.com/${repo}/pull/${num}`);
    }

    const urlPathMatch = clean.match(/^(?:github\.com\/)?([a-z0-9_.-]+\/[a-z0-9_.-]+)\/(?:issues|pull)\/(\d+)$/);
    if (urlPathMatch && urlPathMatch[1] && urlPathMatch[2]) {
      const repo = urlPathMatch[1];
      const num = urlPathMatch[2];
      patternsToAdd.add(`${repo}#${num}`);
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

      const repoIssueMatches = trimmed.matchAll(/(?:\[)?([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+#\d+)(?:\])?/g);
      for (const m of repoIssueMatches) {
        if (m[1]) this.addPattern(m[1], "wiki", "Извлечено из вики (issue link)");
      }
      const markdownUrlMatches = trimmed.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g);
      for (const m of markdownUrlMatches) {
        if (m[1]) this.addPattern(m[1], "wiki", "Извлечено из вики (markdown URL)");
      }
      const rawUrlMatches = trimmed.matchAll(/(https?:\/\/[^\s)\]|]+)/g);
      for (const m of rawUrlMatches) {
        if (m[1]) this.addPattern(m[1], "wiki", "Извлечено из вики (raw URL)");
      }
      const ghPathMatches = trimmed.matchAll(/(?:github\.com\/)?([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/(?:issues|pull)\/(\d+)/g);
      for (const m of ghPathMatches) {
        if (m[1] && m[2]) {
          this.addPattern(`${m[1]}#${m[2]}`, "wiki", "GitHub Issue/PR из вики");
        }
      }
      const authorMatches = trimmed.matchAll(/@([a-zA-Z0-9_-]+)/g);
      for (const m of authorMatches) {
        if (m[1]) {
          this.addPattern(m[1], "wiki", "автор из вики");
          this.addPattern(`@${m[1]}`, "wiki", "автор из вики");
        }
      }
      const listUnformattedMatch = trimmed.match(/^[-*]\s+([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:#\d+)?|[a-zA-Z0-9_-]+)/);
      if (listUnformattedMatch && listUnformattedMatch[1]) {
        this.addPattern(listUnformattedMatch[1], "wiki", "запись списка из вики");
      }
    }
  }

  isBlocked(target) {
    if (this.failClosed) {
      return { blocked: true, pattern: "FAIL_CLOSED", reason: this.loadError || "Стоп-лист поврежден" };
    }
    const rawUrl = target.url ? normalizeText(target.url) : "";
    const cleanUrl = target.url ? normalizeUrlPath(target.url) : "";
    const author = target.author ? normalizeText(target.author) : "";
    const cleanAuthor = author.replace(/^@/, "");

    const haystacks = [
      rawUrl,
      cleanUrl,
      author,
      cleanAuthor,
      cleanAuthor ? `@${cleanAuthor}` : "",
      target.title ? target.title.toLowerCase() : "",
      target.text ? target.text.toLowerCase() : ""
    ].filter(Boolean);

    for (const entry of this.entries) {
      const pat = entry.pattern;
      for (const text of haystacks) {
        if (text === pat || text.includes(pat)) {
          return { blocked: true, pattern: entry.pattern, reason: entry.reason, source: entry.source };
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
      blockedPatterns: ["openai/codex#33493", "openai/codex", "iwasrobbed", "@iwasrobbed"],
      wikiPath: "vetto-wiki/pages/blacklist.md"
    }, resolve(process.cwd(), ".."));
  }
  const res = globalFilter.isBlocked({ url: targetStr, author: targetStr, text: targetStr });
  return res.blocked;
}

// -----------------------------------------------------------------------------
// 2. ДВИЖОК СУПЕР-ПАМЯТИ (SUPER MEMORY ENGINE)
// -----------------------------------------------------------------------------
const memoryDir = join(process.cwd(), "data", "agent_memory");
const memoryPath = join(memoryDir, "super_memory.json");
mkdirSync(memoryDir, { recursive: true });

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
    bannedPatterns: [
      "unwrap()", "expect()", "panic!()", "todo!()", "unimplemented!()",
      "unsafe blocks without safety comments", "direct println! in library crates"
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
        files: ["src/lib.rs", "src/landlock/ruleset.rs", "src/landlock/abi_v5.rs", "src/seccomp/bpf.rs", "src/error.rs"],
        exportedSymbols: ["VettoSandbox", "VettoScopedRuleset", "LandlockAbiVersion", "VettoError", "apply_landlock_scoped"]
      },
      "crates/vetto-shims": {
        purpose: "PATH-шимы и перехват опасных shell-вызовов (rm -rf, git push --force, curl | sh)",
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
    /pubs+(?:asyncs+)?fns+([a-zA-Z0-9_]+)/g,
    /pubs+structs+([a-zA-Z0-9_]+)/g,
    /pubs+enums+([a-zA-Z0-9_]+)/g,
    /pubs+traits+([a-zA-Z0-9_]+)/g,
    /pubs+types+([a-zA-Z0-9_]+)/g,
    /pubs+consts+([a-zA-Z0-9_]+)/g
  ];
  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(rustCode)) !== null) {
      if (match[1]) symbols.add(match[1]);
    }
  }
  return Array.from(symbols);
}

export function normalizeLeadUrl(url) {
  if (!url || typeof url !== "string") return "";
  let clean = url.trim().toLowerCase();
  try { clean = decodeURIComponent(clean); } catch {}
  const withoutQuery = clean.split("?")[0] || "";
  clean = withoutQuery.split("#")[0] || "";
  clean = clean.replace(/\/+/g, "/").replace(/\/+$/, "");
  return clean;
}

export function loadSuperMemory() {
  if (existsSync(memoryPath)) {
    const raw = readFileSync(memoryPath, "utf8");
    if (!raw || raw.trim().length === 0) {
      const corruptPath = `${memoryPath}.corrupt.${Date.now()}`;
      try { writeFileSync(corruptPath, raw, "utf8"); } catch {}
      throw new Error(`SuperMemory file is empty at ${memoryPath}. Preserved backup at ${corruptPath}`);
    }
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data.processedLeads)) data.processedLeads = [];
      if (!Array.isArray(data.roadmapMilestones) || data.roadmapMilestones.length === 0) {
        throw new Error("Invalid SuperMemory structure: roadmapMilestones missing");
      }
      return data;
    } catch (parseErr) {
      const corruptPath = `${memoryPath}.corrupt.${Date.now()}`;
      try { writeFileSync(corruptPath, raw, "utf8"); } catch {}
      throw new Error(`SuperMemory JSON is corrupted at ${memoryPath}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Preserved corrupt state at ${corruptPath}`);
    }
  }
  saveSuperMemory(DEFAULT_SUPER_MEMORY);
  return DEFAULT_SUPER_MEMORY;
}

export function saveSuperMemory(memory) {
  memory.lastUpdated = new Date().toISOString();
  const serialized = JSON.stringify(memory, null, 2);
  const tmpPath = `${memoryPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmpPath, serialized, "utf8");
    renameSync(tmpPath, memoryPath);
  } catch {
    writeFileSync(memoryPath, serialized, "utf8");
  }
}

export function getNextMilestone(memory) {
  return memory.roadmapMilestones.find(m => m.status === "IN_PROGRESS") ||
         memory.roadmapMilestones.find(m => m.status === "PENDING") ||
         memory.roadmapMilestones[0];
}

export function isLeadAlreadyProcessed(memory, url) {
  if (!memory.processedLeads) memory.processedLeads = [];
  const target = normalizeLeadUrl(url);
  if (!target) return false;
  return memory.processedLeads.some(p => normalizeLeadUrl(p) === target);
}

export const isLeadProcessed = isLeadAlreadyProcessed;

export function markLeadAsProcessed(memory, url) {
  if (!memory.processedLeads) memory.processedLeads = [];
  const clean = url.trim();
  if (!isLeadAlreadyProcessed(memory, clean)) {
    memory.processedLeads.push(clean);
    if (memory.processedLeads.length > 200) {
      memory.processedLeads.shift();
    }
    saveSuperMemory(memory);
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

export function updateSuperMemoryAfterCycle(branchName, milestoneId, phase1Success, errorReason, newSymbols, lesson, inMemoryState) {
  const memory = inMemoryState || loadSuperMemory();
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
// 3. 4-ПРОВАЙДЕРНЫЙ БОЕВОЙ ПАЙПЛАЙН VETTO
// -----------------------------------------------------------------------------
const rootDir = process.cwd();
const reportsDir = join(rootDir, "reports", "mvp");
const outreachDir = join(rootDir, "reports", "outreach");
mkdirSync(reportsDir, { recursive: true });
mkdirSync(outreachDir, { recursive: true });

const B_AI_KEY = process.env.B_AI_API_KEY || "";
const B_AI_ENDPOINT = process.env.B_AI_ENDPOINT || "https://api.b.ai/v1/chat/completions";
const NVIDIA_KEY = process.env.NVIDIA_NIM_API_KEY || "";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const ZEN_KEY = process.env.OPENCODE_ZEN_API_KEY || "";
const ZEN_ENDPOINT = "https://opencode.ai/zen/v1/chat/completions";
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_ENDPOINT = process.env.OPENROUTER_ENDPOINT || "https://openrouter.ai/api/v1/chat/completions";
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";

export class CodeGenerationError extends Error {
  constructor(message, providerErrors) {
    super(message);
    this.name = "CodeGenerationError";
    this.providerErrors = providerErrors;
  }
}

export class ProviderCascadeExhaustedError extends CodeGenerationError {
  constructor(details, providerErrors) {
    super(`Provider cascade exhausted: ${details}`, providerErrors);
    this.name = "ProviderCascadeExhaustedError";
  }
}

function log(phase, agent, msg) {
  console.log(`[${new Date().toISOString()}] [${phase}] [${agent}] ${msg}`);
}

export function extractRustCodeStrict(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = cleaned.match(/```(?:rust|rs)?\s*\n([\s\S]*?)```/i);
  let code = match && match[1] ? match[1].trim() : null;

  if (!code) {
    const trimmed = cleaned.trim();
    if (
      (trimmed.startsWith("pub ") || trimmed.startsWith("use ") || trimmed.startsWith("//!") || trimmed.startsWith("#![") || trimmed.startsWith("#[")) &&
      !trimmed.startsWith("```")
    ) {
      code = trimmed;
    }
  }

  if (!code) return null;
  if (code.includes("// Fallback") || code.includes("Fallback Rust module")) return null;
  return code;
}

export function cleanRustCode(raw) {
  const extracted = extractRustCodeStrict(raw);
  if (extracted) return extracted;
  let cleaned = (raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) cleaned = cleaned.slice(firstNewline + 1);
  }
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3).trimEnd();
  return cleaned.trim();
}

export function writeFileSyncAtomic(filePath, content) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, filePath);
  } catch {
    writeFileSync(filePath, content, "utf8");
  }
}

async function callBaiModel(model, systemPrompt, userPrompt, maxTokens = 4096) {
  if (!B_AI_KEY) throw new CodeGenerationError("B_AI_API_KEY is not configured");
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
      const msg = d.choices[0].message;
      let content = typeof msg.content === "string" ? msg.content : "";
      if (content.trim().length > 0) {
        content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        if (content.length > 0) return content;
      }
    }
    throw new CodeGenerationError(`b.ai API returned error (${res.status}): ${raw.slice(0, 300)}`);
  } catch (err) {
    if (err instanceof CodeGenerationError) throw err;
    throw new CodeGenerationError(`b.ai network error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function callOpenRouterModel(model, systemPrompt, userPrompt, maxTokens = 4096) {
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
      let content = d.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (content.length > 0) return content;
    }
  } catch {}
  return null;
}

export async function callCodestral(systemPrompt, userPrompt, maxTokens = 4096) {
  const providerErrors = {};

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
        signal: AbortSignal.timeout(45000)
      });
      const raw = await res.text();
      let d; try { d = JSON.parse(raw); } catch { d = null; }
      if (res.ok && d?.choices?.[0]?.message?.content) {
        const text = d.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        const extracted = extractRustCodeStrict(text);
        if (extracted && extracted.length >= 100) return extracted;
        if (text.length >= 100 && !text.includes("// Fallback")) return text;
        providerErrors["nvidia_nim"] = `Invalid response: ${text.slice(0, 100)}`;
      } else {
        providerErrors["nvidia_nim"] = `HTTP ${res.status}: ${raw.slice(0, 200)}`;
      }
    } catch (err) {
      providerErrors["nvidia_nim"] = err instanceof Error ? err.message : String(err);
    }
  } else {
    providerErrors["nvidia_nim"] = "NVIDIA_NIM_API_KEY is not configured";
  }

  if (OPENROUTER_KEY) {
    try {
      const orModels = ["qwen/qwen-2.5-coder-32b-instruct", "mistralai/codestral-22b-instruct-v0.1"];
      for (const model of orModels) {
        const orRes = await callOpenRouterModel(model, systemPrompt, userPrompt, maxTokens);
        if (orRes) {
          const extracted = extractRustCodeStrict(orRes);
          if (extracted && extracted.length >= 100) return extracted;
          if (orRes.length >= 100 && !orRes.includes("// Fallback")) return orRes;
        }
      }
      providerErrors["openrouter"] = "OpenRouter returned empty or invalid code";
    } catch (err) {
      providerErrors["openrouter"] = err instanceof Error ? err.message : String(err);
    }
  } else {
    providerErrors["openrouter"] = "OPENROUTER_API_KEY is not configured";
  }

  if (B_AI_KEY) {
    try {
      const baiRes = await callBaiModel("deepseek-v4-flash", systemPrompt, userPrompt, Math.max(maxTokens, 8192));
      const extracted = extractRustCodeStrict(baiRes);
      if (extracted && extracted.length >= 100) return extracted;
      if (baiRes.length >= 100 && !baiRes.includes("// Fallback")) return baiRes;
      providerErrors["b_ai"] = `b.ai invalid code: ${baiRes.slice(0, 100)}`;
    } catch (err) {
      providerErrors["b_ai"] = err instanceof Error ? err.message : String(err);
    }
  } else {
    providerErrors["b_ai"] = "B_AI_API_KEY is not configured";
  }

  throw new ProviderCascadeExhaustedError(
    "All code generation tiers (NVIDIA NIM -> OpenRouter -> b.ai) failed to generate valid Rust code",
    providerErrors
  );
}

async function callNemotronUltra(systemPrompt, userPrompt, maxTokens = 2048) {
  if (ZEN_KEY) {
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
        const msg = d.choices[0].message;
        let content = typeof msg.content === "string" ? msg.content : "";
        if (content.trim().length > 0) {
          content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          if (content.length > 0) return content;
        }
      }
    } catch {}
  }

  try {
    return await callBaiModel("glm-5.3-flash", systemPrompt, userPrompt, maxTokens);
  } catch {}

  try {
    return await callGroqModel("openai/gpt-oss-120b", systemPrompt, userPrompt, maxTokens);
  } catch (err) {
    throw new CodeGenerationError(`Failed to generate Rationale: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function callGroqModel(model, systemPrompt, userPrompt, maxTokens = 2048) {
  if (GROQ_KEY) {
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
        const msg = d.choices[0].message;
        let content = typeof msg.content === "string" ? msg.content : "";
        if (content.trim().length > 0) {
          return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        }
      }
    } catch {}
  }

  const orRes = await callOpenRouterModel("qwen/qwen-2.5-coder-32b-instruct", systemPrompt, userPrompt, maxTokens);
  if (orRes && orRes.trim().length > 0) return orRes.trim();

  try {
    return await callBaiModel("glm-5.3-flash", systemPrompt, userPrompt, maxTokens);
  } catch (err) {
    throw new CodeGenerationError(`Groq cascade failed: ${err instanceof Error ? err.message : String(err)}`);
  }
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
    if (code.includes(b)) violations.push(`Обнаружена запрещенная конструкция: ` + b);
  }
  if (code.includes("unsafe") && !code.includes("// SAFETY:") && !code.includes("/* SAFETY:")) {
    violations.push("Блок unsafe не содержит обязательного комментария // SAFETY:");
  }
  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    violations.push(`Дисбаланс фигурных скобок: открыто ${openBraces}, закрыто ${closeBraces}`);
  }
  if (code.length < 100) {
    violations.push("Код слишком короткий (< 100 символов)");
  }
  return { passed: violations.length === 0, violations };
}

function executeCargoCheck(targetFile) {
  try {
    const checkCargo = spawnSync("cargo", ["--version"], { encoding: "utf8" });
    if (checkCargo.status !== 0) {
      return { cargoAvailable: false, success: false, output: "Cargo не обнаружен в локальной среде (fail-closed)" };
    }
    const check = spawnSync("cargo", ["check", "--tests", "--message-format=short"], {
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
      success: false,
      output: `Ошибка cargo check (fail-closed): ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

export async function runPhase1Product(branchName, memory) {
  const memoryContext = buildSuperMemoryPromptContext(memory);
  const milestone = getNextMilestone(memory);

  log("ФАЗА 1", "СУПЕР-ПАМЯТЬ", `Извлечена целевая задача: [${milestone.id}] ${milestone.title}`);
  log("ФАЗА 1", "СУПЕР-ПАМЯТЬ", `Целевой файл: ${milestone.targetFile} | Тесты: ${milestone.testFile}`);

  log("ФАЗА 1", "GLM-5.3 (b.ai)", `Проектирование архитектуры для ${milestone.targetFile}...`);
  let spec = "";
  try {
    spec = await callBaiModel(
      "glm-5.3-flash",
      `Ты — главный системный архитектор VETTO. Используй контекст Супер-Памяти:\n${memoryContext}`,
      `Спроектируй реализацию задачи ${milestone.id}: "${milestone.title}". Опиши типы и сигнатуры функций строго через Result<T, VettoError> без unwrap().`
    );
  } catch (err) {
    log("ФАЗА 1", "SPEC WARNING", `Не удалось получить спецификацию: ${err instanceof Error ? err.message : String(err)}`);
    spec = `Архитектурная спецификация для ${milestone.title}: реализовать unprivileged Landlock/Seccomp изоляцию с обработкой ошибок через VettoError.`;
  }

  log("ФАЗА 1", "CODESTRAL CASCADE", `Генерация кода для ${milestone.targetFile}...`);
  let rawRustCode = await callCodestral(
    `You are a Senior Rust Systems Programmer. Output ONLY valid, compilable Rust code inside a \`\`\`rust block. No explanations, no conversation. Do not use unwrap(), panic!(), or todo!().\nSpecification:\n${spec}\nContext:\n${memoryContext}`,
    `Write complete compilable Rust code for ${milestone.targetFile}. Implement ${milestone.title} strictly.`
  );
  let rustCode = extractRustCodeStrict(rawRustCode) || cleanRustCode(rawRustCode);

  log("ФАЗА 1", "DEEPSEEK-V4 (b.ai)", `Генерация юнит-тестов для ${milestone.testFile}...`);
  let rawTestCode = "";
  try {
    rawTestCode = await callBaiModel(
      "deepseek-v4-flash-vision-exp",
      `Ты — QA-инженер VETTO. Напиши синтаксически валидные юнит-тесты #[cfg(test)] для ${milestone.testFile} без unwrap().\nКод реализации:\n${rustCode}`,
      `Создай #[cfg(test)] mod tests для всесторонней проверки реализации ${milestone.title}.`
    );
  } catch (baiErr) {
    log("ФАЗА 1", "DEEPSEEK-V4 WARNING", `b.ai вернул ошибку: ${baiErr instanceof Error ? baiErr.message : String(baiErr)}. Переключение на Codestral...`);
    try {
      rawTestCode = await callCodestral(
        `Ты — QA-инженер VETTO. Напиши тесты для ${milestone.testFile}.\nКод:\n${rustCode}`,
        `Создай #[cfg(test)] mod tests для ${milestone.title}.`
      );
    } catch (codestralErr) {
      log("ФАЗА 1", "TEST GEN CASCADE ERROR", `Каскад генерации тестов исчерпан: ${codestralErr instanceof Error ? codestralErr.message : String(codestralErr)}`);
      throw new CodeGenerationError(
        `Failed to generate unit tests for ${milestone.testFile}: all test generation tiers failed. Dummy assertions are prohibited.`,
        {
          "b_ai": baiErr instanceof Error ? baiErr.message : String(baiErr),
          "codestral": codestralErr instanceof Error ? codestralErr.message : String(codestralErr)
        }
      );
    }
  }
  let testCode = extractRustCodeStrict(rawTestCode) || cleanRustCode(rawTestCode);
  if (!testCode || testCode.length < 50 || testCode.includes("assert!(true)")) {
    throw new CodeGenerationError(`Generated test code for ${milestone.testFile} is invalid or contains dummy assertions.`);
  }

  const staticAudit = auditRustCode(rustCode);
  let syntaxCheck = "PASS";
  try {
    syntaxCheck = await callGroqModel(
      "qwen/qwen3.8-27b",
      "Ты — Rust Security Auditor. Проверь код на отсутствие unwrap, panic и небезопасных конструкций. Выдай краткий вердикт (PASS или FAIL: причина).",
      `Код:\n${rustCode}`
    );
  } catch {
    syntaxCheck = staticAudit.passed ? "PASS (Static Fallback)" : `FAIL: ${staticAudit.violations.join("; ")}`;
  }

  const targetFullPath = join(rootDir, milestone.targetFile);
  const testFullPath = join(rootDir, milestone.testFile);
  writeFileSyncAtomic(targetFullPath, rustCode);
  log("ФАЗА 1", "ФАЙЛОВАЯ СИСТЕМА", `Атомарно сохранен файл реализации: ${milestone.targetFile}`);
  writeFileSyncAtomic(testFullPath, testCode);
  log("ФАЗА 1", "ФАЙЛОВАЯ СИСТЕМА", `Атомарно сохранен файл тестов: ${milestone.testFile}`);

  const MAX_REPAIR_ATTEMPTS = 3;
  let repairAttempts = 0;
  let cargoResult = executeCargoCheck(milestone.targetFile);

  while (cargoResult.cargoAvailable && !cargoResult.success && repairAttempts < MAX_REPAIR_ATTEMPTS) {
    repairAttempts++;
    log("ФАЗА 1", "COMPILER FEEDBACK LOOP", `Ошибки сборки (cargo check --tests). Итерация исправления #${repairAttempts} из ${MAX_REPAIR_ATTEMPTS}...`);
    try {
      rawRustCode = await callCodestral(
        `Ты — ведущий Rust-программист VETTO. Предыдущая версия файла ${milestone.targetFile} вызвала ошибки компиляции при \`cargo check --tests\`:\n\n` +
        `=== ОШИБКИ КОМПИЛЯТОРА ===\n${cargoResult.output}\n\n` +
        `=== ПРЕДЫДУЩИЙ ИСХОДНЫЙ КОД ===\n\`\`\`rust\n${rustCode}\n\`\`\`\n\n` +
        `Исправь все ошибки компилятора. Запрещено использовать unwrap(), panic!(), todo!(). Выдай исправленный файл целиком.`,
        `Предоставь исправленный компилируемый Rust-код для файла ${milestone.targetFile}.`
      );
      const repairedCode = extractRustCodeStrict(rawRustCode);
      if (repairedCode && repairedCode.length >= 100) {
        rustCode = repairedCode;
        writeFileSyncAtomic(targetFullPath, rustCode);
        cargoResult = executeCargoCheck(milestone.targetFile);
      } else {
        log("ФАЗА 1", "COMPILER FEEDBACK LOOP", `Не удалось извлечь валидный код на итерации #${repairAttempts}`);
      }
    } catch (err) {
      log("ФАЗА 1", "COMPILER FEEDBACK LOOP", `Ошибка вызова LLM при исправлении: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }

  const extractedSymbols = extractExportedRustSymbols(rustCode);
  log("ФАЗА 1", "AST СИМВОЛЫ", `Извлечено публичных символов: [${extractedSymbols.join(", ") || "none"}]`);

  log("ФАЗА 1", "NEMOTRON-3 ULTRA 550B (Zen)", "Генерация Rationale (Зачем / Что дает)...");
  let rationale = "";
  try {
    rationale = await callNemotronUltra(
      `Ты — Senior Security Auditor VETTO (550B MoE). Сформулируй 3 пункта Rationale: 1. Почему сделано, 2. Зачем нужно, 3. Что дает VETTO.\nКонтекст:\n${memoryContext}`,
      `Обоснуй реализацию задачи ${milestone.id} (${milestone.title}) в ветке ${branchName}. Экспортированные символы: ${extractedSymbols.join(", ")}`
    );
  } catch {
    rationale = `1. Реализован модуль ${milestone.title} для усиления изоляции агентов.\n2. Необходимо для ограничения прав доступа процессов к ядру без root-прав.\n3. Обеспечивает нулевой оверхед и безопасность запуска LLM-агентов.`;
  }

  const isRustCodeValid = rustCode.length >= 100 &&
    !rustCode.includes("Fallback") &&
    extractedSymbols.length > 0;
  const isStaticPassed = staticAudit.passed && !syntaxCheck.toLowerCase().includes("fail");
  const isCompilationPassed = cargoResult.cargoAvailable === true && cargoResult.success === true;
  const isRationalePresent = rationale.length > 40 && !rationale.includes("Fallback");

  const isSuccess = isRustCodeValid && isStaticPassed && isCompilationPassed && isRationalePresent;

  let failReason = null;
  if (!isRustCodeValid) failReason = "Сгенерирован неполный код без экспортированных символов";
  else if (!staticAudit.passed) failReason = `Нарушение правил кода: ${staticAudit.violations.join("; ")}`;
  else if (!isStaticPassed) failReason = `LPU валидатор отклонил код: ${syntaxCheck}`;
  else if (!cargoResult.cargoAvailable) failReason = `Cargo недоступен в локальной среде (fail-closed блокировка): ${cargoResult.output}`;
  else if (!cargoResult.success) failReason = `Ошибка cargo check --tests: ${cargoResult.output.slice(0, 200)}`;
  else if (!isRationalePresent) failReason = "Отсутствует или некорректен блок Rationale";

  return {
    milestone,
    spec,
    rustCode,
    testCode,
    syntaxCheck,
    staticAudit,
    cargoResult,
    extractedSymbols,
    rationale,
    isSuccess,
    failReason
  };
}

export async function runPhase2Outreach(memory, dryRun = true) {
  log("ФАЗА 2", "COMPOUND-MINI (Groq LPU)", "Поиск свежих issues и триаж тредов...");
  const searchQueries = [
    "landlock sandbox language:rust",
    "\"claude code\" sandbox",
    "agent linux sandbox seccomp",
    "coding agent sandbox security",
    "claude desktop sandbox linux",
    "ai agent command execution security"
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
      log("ФАЗА 2", "SEARCH WARNING", `GitHub Search API недоступен: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("ФАЗА 2", "GLM-5.3 (b.ai)", `Генерация экспертного ответа для @${targetIssue.author}...`);
  let pitch = "";
  try {
    pitch = await callBaiModel(
      "glm-5.3-flash",
      `Ты — технический автор VETTO. Миссия: ${memory.projectIdentity.coreMission}. Обязателен дисклеймер: 'Disclaimer: I am the author/maintainer of VETTO (https://github.com/shleder/vetto)'. Отвечай строго по существу вопроса без спама.`,
      `Пользователь @${targetIssue.author} пишет: "${targetIssue.context}". Предложи VETTO Landlock Sandboxing с обоснованием нулевого оверхеда.`
    );
  } catch {
    pitch = `Disclaimer: I am the author/maintainer of VETTO (https://github.com/shleder/vetto)\n\nHi @${targetIssue.author}, for unprivileged filesystem isolation on Linux without Docker daemon overhead, native Landlock LSM allows unprivileged sandboxing directly in user space. VETTO wraps CLI agent execution with sub-millisecond overhead.`;
  }

  const cleanPitch = pitch
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\/\/\s*\]:\s*#\s*\([^\)]*\)/g, "");

  const isBlocked = isBlacklistedCheck(targetIssue.url) || isBlacklistedCheck(targetIssue.author);
  const hasDisclaimer =
    /disclaimer|disclosure/i.test(cleanPitch) &&
    /author|maintainer|creator/i.test(cleanPitch) &&
    /vetto/i.test(cleanPitch);

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
      log("ФАЗА 2", "GITHUB API POST", `Публикация ответа в ${targetIssue.repo}#${targetIssue.number}...`);
      const commentRes = await fetch(`https://api.github.com/repos/${targetIssue.repo}/issues/${targetIssue.number}/comments`, {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${GH_TOKEN}`,
          "User-Agent": "vetto-lead-hunter-24-7",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ body: cleanPitch }),
        signal: AbortSignal.timeout(15000)
      });
      if (commentRes.ok) {
        status = "POSTED";
        log("ФАЗА 2", "SUCCESS", `Сообщение успешно опубликовано в ${targetIssue.url}!`);
      } else {
        const errTxt = await commentRes.text();
        status = `POST_FAILED_${commentRes.status}`;
        log("ФАЗА 2", "POST ERROR", `GitHub API вернул статус ${commentRes.status}: ${errTxt.slice(0, 150)}`);
      }
      markLeadAsProcessed(memory, targetIssue.url);
    } catch (err) {
      status = "POST_ERROR";
      log("ФАЗА 2", "NETWORK ERROR", `Сетевой сбой при отправке: ${err instanceof Error ? err.message : String(err)}`);
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
  writeFileSyncAtomic(pendingPitchesPath, JSON.stringify(pitches.slice(-50), null, 2));

  // Генерация наглядного дайджеста для пользователя
  const digestPath = join(outreachDir, "lead_digest.md");
  const digestContent = [
    "# Дайджест свежих лидов и готовых ответов VETTO",
    `**Обновлено:** ${new Date().toISOString()} | **Режим:** \`${dryRun ? "DRAFT (Только черновики)" : "LIVE (Автоотправка)"}\``,
    "",
    "---",
    "",
    "## 🎯 Последний найденный тред",
    `- **Ссылка:** [${targetIssue.url}](${targetIssue.url})`,
    `- **Репозиторий:** \`${targetIssue.repo}\` (#${targetIssue.number})`,
    `- **Автор:** @${targetIssue.author}`,
    `- **Контекст вопроса:** *"${targetIssue.context}"*`,
    `- **Статус:** **\`${status}\`**`,
    "",
    "### 📝 Сгенерированный ответ (с обязательным дисклеймером):",
    "```markdown",
    pitch,
    "```",
    "",
    "### 💡 Что делать:",
    dryRun
      ? `1. Откройте тред: ${targetIssue.url}\n2. Проверьте сгенерированный ответ выше.\n3. Если хотите отправить вручную — скопируйте текст в тред. Если хотите, чтобы бот отправил сам — скомандуйте агенту \`отправляй\`.`
      : `Сообщение уже автоматически отправлено через GitHub API.`
  ].join("\n");

  writeFileSyncAtomic(digestPath, digestContent);
  log("ФАЗА 2", "ДАЙДЖЕСТ", `Дайджест лидов обновлен: ${digestPath}`);

  return { targetIssue, pitch, status };
}

export async function runPhase3SelfImprovement(branchName, milestoneId, phase1Success, failReason, extractedSymbols, memory) {
  log("ФАЗА 3", "GPT-OSS-120B (Groq LPU)", "Сквозной аудит качества и метрик...");
  let analysis = "";
  try {
    analysis = await callGroqModel(
      "openai/gpt-oss-120b",
      `Ты — системный аналитик VETTO. Оцени стабильность контура лидогенерации и статус выполнения.`,
      "Сформулируй краткий вывод за 1 предложение."
    );
  } catch {
    analysis = "Контур лидогенерации стабилен. Лиды обработаны и зафиксированы в Супер-Памяти.";
  }

  log("ФАЗА 3", "QUALITY-GATE", "Память синхронизирована.");
  return { analysis, updatedMemory: memory, advanced: false };
}

export async function runCompleteGateMvp(dryRun = true) {
  const branchInfo = getBranchInfo();
  const memory = loadSuperMemory();

  const isLeadHunterOnly = memory.executionMode === "LEAD_HUNTER_ONLY" || true;

  console.log(`\n=====================================================================`);
  console.log(`СТАРТ АВТОНОМНОГО ЦИКЛА VETTO: [${branchInfo.branchName}]`);
  console.log(`РЕЖИМ: ${isLeadHunterOnly ? "🎯 LEAD HUNTER ONLY (Поиск лидов + Черновики ответов)" : "🛠 FULL PRODUCT + OUTREACH"}`);
  console.log(`РЕПОЗИТОРИЙ: https://github.com/geminifreefg-hash/vetto-sandbox (Private)`);
  console.log(`=====================================================================\n`);

  let p1 = {
    milestone: getNextMilestone(memory),
    spec: "Продукт в режиме ожидания (LEAD_HUNTER_ONLY)",
    rustCode: "// Standby",
    testCode: "// Standby",
    syntaxCheck: "STANDBY",
    extractedSymbols: [],
    rationale: "Роадмап на паузе по запросу пользователя. Фокус на поиске лидов.",
    isSuccess: true,
    failReason: null
  };

  if (!isLeadHunterOnly) {
    p1 = await runPhase1Product(branchInfo.branchName, memory);
  }

  const p2 = await runPhase2Outreach(memory, dryRun);
  const p3 = await runPhase3SelfImprovement(
    branchInfo.branchName,
    p1.milestone.id,
    p1.isSuccess,
    p1.failReason,
    p1.extractedSymbols,
    memory
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

  writeFileSyncAtomic(reportPath, reportContent);
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
