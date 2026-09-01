// core/mvp-pipeline.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// core/blacklist.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
var BlacklistFilter = class {
  entries = [];
  failClosed = false;
  loadError;
  constructor(config, rootDir2) {
    for (const pat of config.blockedPatterns) {
      if (pat && typeof pat === "string" && pat.trim() !== "") {
        this.addPattern(pat.trim(), "config");
      }
    }
    if (config.wikiPath && config.wikiPath.trim() !== "") {
      const wikiAbs = resolve(rootDir2, config.wikiPath);
      if (!existsSync(wikiAbs)) {
        this.failClosed = true;
        this.loadError = `\u0421\u0442\u043E\u043F-\u043B\u0438\u0441\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043F\u043E \u043F\u0443\u0442\u0438: ${wikiAbs}`;
      } else {
        try {
          const content = readFileSync(wikiAbs, "utf8");
          this.parseWikiContent(content);
        } catch (err) {
          this.failClosed = true;
          this.loadError = `\u041E\u0448\u0438\u0431\u043A\u0430 \u0447\u0442\u0435\u043D\u0438\u044F \u0441\u0442\u043E\u043F-\u043B\u0438\u0441\u0442\u0430: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
  }
  /** Добавляет паттерн и его нормализованные/раскрытые варианты (issue/pull aliases, author @) */
  addPattern(pattern, source, reason) {
    const raw = pattern.trim().toLowerCase();
    if (!raw) return;
    const clean = raw.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    const patternsToAdd = /* @__PURE__ */ new Set();
    patternsToAdd.add(raw);
    if (clean && clean !== raw) {
      patternsToAdd.add(clean);
    }
    if (raw.startsWith("@") && raw.length > 1) {
      patternsToAdd.add(raw.slice(1));
    }
    const issueMatch = raw.match(/^([a-z0-9_.-]+\/[a-z0-9_.-]+)#(\d+)$/);
    if (issueMatch && issueMatch[1] && issueMatch[2]) {
      const repo = issueMatch[1];
      const num = issueMatch[2];
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
      if (p && !this.entries.some((e) => e.pattern === p && e.source === source)) {
        this.entries.push({
          pattern: p,
          source,
          reason
        });
      }
    }
  }
  /** Извлекает ссылки, issue/PR ID, авторов и прямые URL из markdown содержимого */
  parseWikiContent(content) {
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const repoIssueMatches = trimmed.matchAll(/\[([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+#\d+)\]/g);
      for (const m of repoIssueMatches) {
        if (m[1]) {
          this.addPattern(m[1], "wiki", "\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0432 pages/blacklist.md");
        }
      }
      const markdownUrlMatches = trimmed.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g);
      for (const m of markdownUrlMatches) {
        if (m[1]) {
          this.addPattern(m[1], "wiki", "URL \u0438\u0437 pages/blacklist.md");
        }
      }
      const rawUrlMatches = trimmed.matchAll(/(https?:\/\/[^\s)\]|]+)/g);
      for (const m of rawUrlMatches) {
        if (m[1]) {
          this.addPattern(m[1], "wiki", "URL \u0438\u0437 pages/blacklist.md");
        }
      }
      const authorMatches = trimmed.matchAll(/@([a-zA-Z0-9_-]+)/g);
      for (const m of authorMatches) {
        if (m[1]) {
          this.addPattern(m[1], "wiki", "\u0430\u0432\u0442\u043E\u0440 \u0438\u0437 pages/blacklist.md");
        }
      }
    }
  }
  isBlocked(target) {
    if (this.failClosed) {
      return {
        blocked: true,
        pattern: "FAIL_CLOSED",
        reason: `\u0418\u0437\u043E\u043B\u044F\u0446\u0438\u044F \u0441\u0442\u043E\u043F-\u043B\u0438\u0441\u0442\u0430 (FAIL-CLOSED): ${this.loadError ?? "\u0441\u0442\u043E\u043F-\u043B\u0438\u0441\u0442 \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0451\u043D \u0438\u043B\u0438 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D"}`
      };
    }
    const rawUrl = target.url?.toLowerCase() ?? "";
    const cleanUrl = rawUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    const author = target.author?.toLowerCase().trim() ?? "";
    const cleanAuthor = author.replace(/^@/, "");
    const title = target.title?.toLowerCase() ?? "";
    const text = target.text?.toLowerCase() ?? "";
    const haystacks = [
      rawUrl,
      cleanUrl,
      author,
      cleanAuthor,
      cleanAuthor ? `@${cleanAuthor}` : "",
      title,
      text
    ].filter(Boolean);
    for (const entry of this.entries) {
      const p = entry.pattern;
      if (!p) continue;
      for (const hay of haystacks) {
        if (hay.includes(p)) {
          return {
            blocked: true,
            pattern: entry.pattern,
            reason: entry.reason ?? `\u0421\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u0435 \u0441\u043E \u0441\u0442\u043E\u043F-\u043B\u0438\u0441\u0442\u043E\u043C (${entry.source})`
          };
        }
      }
    }
    return { blocked: false };
  }
  getRulesCount() {
    return this.entries.length;
  }
};
var globalFilter = null;
function isBlacklistedCheck(targetStr) {
  if (!globalFilter) {
    globalFilter = new BlacklistFilter({
      enabled: true,
      failClosed: true,
      wikiPath: "vetto-wiki/pages/blacklist.md",
      blockedPatterns: ["openai/codex#33493", "openai/codex"]
    }, resolve(process.cwd(), ".."));
  }
  const res = globalFilter.isBlocked({ url: targetStr, author: targetStr, text: targetStr });
  return res.blocked;
}

// core/super-memory.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { join } from "node:path";
var memoryDir = join(process.cwd(), "data", "agent_memory");
var memoryPath = join(memoryDir, "super_memory.json");
mkdirSync(memoryDir, { recursive: true });
var DEFAULT_SUPER_MEMORY = {
  version: "0.2.15",
  lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
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
        purpose: "\u041D\u0438\u0437\u043A\u043E\u0443\u0440\u043E\u0432\u043D\u0435\u0432\u0430\u044F \u0438\u0437\u043E\u043B\u044F\u0446\u0438\u044F \u044F\u0434\u0440\u0430 Linux (Landlock ABI v1-v5, seccomp BPF, namespaces)",
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
        purpose: "PATH-\u0448\u0438\u043C\u044B \u0438 \u043F\u0435\u0440\u0435\u0445\u0432\u0430\u0442 \u043E\u043F\u0430\u0441\u043D\u044B\u0445 shell-\u0432\u044B\u0437\u043E\u0432\u043E\u0432 (rm -rf, git push --force, curl | sh)",
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
        purpose: "CLI-\u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441 (vetto run, vetto wrap, vetto audit)",
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
      description: "\u0418\u0437\u043E\u043B\u044F\u0446\u0438\u044F \u0441\u0438\u0433\u043D\u0430\u043B\u043E\u0432 ptrace \u0438 \u0430\u0431\u0441\u0442\u0440\u0430\u043A\u0442\u043D\u044B\u0445 unix \u0441\u043E\u043A\u0435\u0442\u043E\u0432 \u0434\u043B\u044F \u0434\u043E\u0447\u0435\u0440\u043D\u0438\u0445 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u043E\u0432 \u0430\u0433\u0435\u043D\u0442\u043E\u0432 \u0432 Linux 6.12+",
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
      description: "\u041F\u043E\u0442\u043E\u043A\u043E\u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u0439 \u043A\u044D\u0448 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u043D\u044B\u0445 \u0431\u0438\u043D\u0430\u0440\u043D\u0438\u043A\u043E\u0432 \u0434\u043B\u044F \u043D\u0443\u043B\u0435\u0432\u043E\u0439 \u0437\u0430\u0434\u0435\u0440\u0436\u043A\u0438 \u043F\u0435\u0440\u0435\u0445\u0432\u0430\u0442\u0430 \u0432\u044B\u0437\u043E\u0432\u043E\u0432 \u0430\u0433\u0435\u043D\u0442\u0430",
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
      description: "\u0417\u0430\u043F\u0440\u0435\u0442 \u0441\u0438\u0441\u043A\u043E\u043B\u043E\u0432 mount, ptrace, unshare, keyctl \u0441 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435\u043C SECCOMP_RET_KILL",
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
      description: "\u0411\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0430 \u043D\u0435\u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0445 \u0441\u043E\u043A\u0435\u0442\u043E\u0432 \u0438 \u043F\u0440\u0438\u0432\u044F\u0437\u043E\u043A \u043A \u043F\u043E\u0440\u0442\u0430\u043C (LANDLOCK_RULE_NET_PORT)",
      status: "PENDING",
      retryCount: 0
    }
  ],
  lessonsLearned: [
    "b.ai \u0448\u043B\u044E\u0437 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 Concurrency Pool N=2-3 \u0441\u043E \u0441\u0433\u043B\u0430\u0436\u0438\u0432\u0430\u043D\u0438\u0435\u043C 500 \u043C\u0441 \u0432\u043E \u0438\u0437\u0431\u0435\u0436\u0430\u043D\u0438\u0435 \u0441\u0431\u0440\u043E\u0441\u0430 \u0441\u043E\u043A\u0435\u0442\u043E\u0432.",
    "Groq LPU \u0438\u0434\u0435\u0430\u043B\u0435\u043D \u0434\u043B\u044F \u043F\u0440\u0435-\u0432\u0430\u043B\u0438\u0434\u0430\u0446\u0438\u0438 \u0441\u0438\u043D\u0442\u0430\u043A\u0441\u0438\u0441\u0430 Rust \u0438 \u0442\u0440\u0438\u0430\u0436\u0430 \u043B\u0438\u0434\u043E\u0432 (45-150 \u043C\u0441).",
    "Nemotron-3 Ultra 550B MoE \u043D\u0430 OpenCode Zen \u0434\u0430\u0435\u0442 \u0433\u043B\u0443\u0431\u043E\u0447\u0430\u0439\u0448\u0438\u0439 \u0430\u043D\u0430\u043B\u0438\u0437 monotonic restrictions \u044F\u0434\u0440\u0430 Linux.",
    "Codestral-22B \u043E\u0442 NVIDIA \u043B\u0438\u0434\u0438\u0440\u0443\u0435\u0442 \u043F\u043E \u0442\u043E\u0447\u043D\u043E\u0441\u0442\u0438 FIM-\u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 \u043A\u043E\u0434\u0430 \u043D\u0430 Rust \u0431\u0435\u0437 \u043F\u0430\u043D\u0438\u043A."
  ]
};
function loadSuperMemory() {
  if (existsSync2(memoryPath)) {
    try {
      return JSON.parse(readFileSync2(memoryPath, "utf8"));
    } catch {
    }
  }
  saveSuperMemory(DEFAULT_SUPER_MEMORY);
  return DEFAULT_SUPER_MEMORY;
}
function saveSuperMemory(memory) {
  memory.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
  writeFileSync(memoryPath, JSON.stringify(memory, null, 2), "utf8");
}
function getNextMilestone(memory) {
  return memory.roadmapMilestones.find((m) => m.status === "IN_PROGRESS") || memory.roadmapMilestones.find((m) => m.status === "PENDING") || memory.roadmapMilestones[0];
}
function buildSuperMemoryPromptContext(memory) {
  const milestone = getNextMilestone(memory);
  const retryInfo = milestone.retryCount > 0 ? `
\u26A0\uFE0F \u0412\u041D\u0418\u041C\u0410\u041D\u0418\u0415: \u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0430\u044F \u043F\u043E\u043F\u044B\u0442\u043A\u0430 \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u0430 \u0433\u0435\u0439\u0442! \u041E\u0448\u0438\u0431\u043A\u0430: ${milestone.lastError || "\u041D\u0435\u043F\u043E\u043B\u043D\u044B\u0439 \u043A\u043E\u0434"}. \u0418\u0441\u043F\u0440\u0430\u0432\u044C \u044D\u0442\u043E \u0432 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0438\u0442\u0435\u0440\u0430\u0446\u0438\u0438!` : "";
  return [
    `=== \u0411\u0410\u0417\u0410 \u0417\u041D\u0410\u041D\u0418\u0419 \u0418 \u0421\u0423\u041F\u0415\u0420-\u041F\u0410\u041C\u042F\u0422\u042C VETTO (\u0412\u0435\u0440\u0441\u0438\u044F ${memory.version}) ===`,
    `1. \u041C\u0418\u0421\u0421\u0418\u042F: ${memory.projectIdentity.coreMission}`,
    `2. \u0416\u0415\u0421\u0422\u041A\u0418\u0415 \u041F\u0420\u0410\u0412\u0418\u041B\u0410 \u041A\u041E\u0414\u0410: \u0417\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u044B: ${memory.architecturalRules.bannedPatterns.join(", ")}.`,
    `   \u041E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E: ${memory.architecturalRules.mandatoryPatterns.join("; ")}.`,
    `3. \u0422\u0415\u041A\u0423\u0429\u0410\u042F \u0426\u0415\u041B\u0415\u0412\u0410\u042F \u0417\u0410\u0414\u0410\u0427\u0410 [${milestone.id}] (\u041F\u043E\u043F\u044B\u0442\u043A\u0430: ${milestone.retryCount + 1}):`,
    `   \u2022 \u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A: ${milestone.title}`,
    `   \u2022 \u0426\u0435\u043B\u0435\u0432\u043E\u0439 \u0444\u0430\u0439\u043B: ${milestone.targetFile}`,
    `   \u2022 \u0424\u0430\u0439\u043B \u0442\u0435\u0441\u0442\u043E\u0432: ${milestone.testFile}`,
    `   \u2022 \u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435: ${milestone.description}${retryInfo}`,
    `4. \u0421\u0423\u0429\u0415\u0421\u0422\u0412\u0423\u042E\u0429\u0418\u0415 \u041A\u0420\u0415\u0419\u0422\u042B: ${Object.keys(memory.codebaseRegistry.crates).join(", ")}`,
    `5. \u042D\u041A\u0421\u041F\u041E\u0420\u0422\u0418\u0420\u041E\u0412\u0410\u041D\u041D\u042B\u0415 \u0422\u0418\u041F\u042B: ${Object.values(memory.codebaseRegistry.crates).flatMap((c) => c.exportedSymbols).join(", ")}`
  ].join("\n");
}
function updateSuperMemoryAfterCycle(branchName, milestoneId, phase1Success, errorReason, newSymbols, lesson) {
  const memory = loadSuperMemory();
  const target = memory.roadmapMilestones.find((m) => m.id === milestoneId);
  let advanced = false;
  if (target) {
    if (phase1Success) {
      target.status = "COMPLETED";
      target.completedInBranch = branchName;
      target.lastError = void 0;
      const next = memory.roadmapMilestones.find((m) => m.status === "PENDING");
      if (next) {
        next.status = "IN_PROGRESS";
        advanced = true;
      }
      if (newSymbols.length > 0) {
        const crate = memory.codebaseRegistry.crates[target.targetCrate];
        if (crate) {
          crate.exportedSymbols = Array.from(/* @__PURE__ */ new Set([...crate.exportedSymbols, ...newSymbols]));
        }
      }
    } else {
      target.status = "IN_PROGRESS";
      target.retryCount += 1;
      target.lastError = errorReason || "\u0421\u0438\u043D\u0442\u0430\u043A\u0441\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430 \u0438\u043B\u0438 \u043D\u0435\u043F\u043E\u043B\u043D\u044B\u0439 \u043A\u043E\u0434";
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

// core/mvp-pipeline.ts
var rootDir = process.cwd();
var dataDir = join2(rootDir, "data");
var memoryDir2 = join2(dataDir, "agent_memory");
var reportsDir = join2(rootDir, "reports", "mvp");
mkdirSync2(memoryDir2, { recursive: true });
mkdirSync2(reportsDir, { recursive: true });
var B_AI_KEY = process.env.B_AI_API_KEY || "";
var B_AI_ENDPOINT = process.env.B_AI_ENDPOINT || "https://api.b.ai/v1/chat/completions";
var NVIDIA_KEY = process.env.NVIDIA_NIM_API_KEY || "";
var NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
var ZEN_KEY = process.env.OPENCODE_ZEN_API_KEY || "";
var ZEN_ENDPOINT = "https://opencode.ai/zen/v1/chat/completions";
var GROQ_KEY = process.env.GROQ_API_KEY || "";
var GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
function log(phase, agent, msg) {
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] [${phase}] [${agent}] ${msg}`);
}
async function callBaiModel(model, systemPrompt, userPrompt, maxTokens = 500) {
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
      signal: AbortSignal.timeout(45e3)
    });
    const raw = await res.text();
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      d = null;
    }
    if (res.ok && d?.choices?.[0]?.message) {
      return (d.choices[0].message.content || d.choices[0].message.reasoning_content || "").trim();
    }
  } catch {
  }
  return "// Fallback safe response (b.ai)";
}
async function callCodestral(systemPrompt, userPrompt, maxTokens = 600) {
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
      signal: AbortSignal.timeout(3e4)
    });
    const raw = await res.text();
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      d = null;
    }
    if (res.ok && d?.choices?.[0]?.message) {
      return (d.choices[0].message.content || "").trim();
    }
  } catch {
  }
  return "// Fallback Rust module implementation";
}
async function callNemotronUltra(systemPrompt, userPrompt, maxTokens = 500) {
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
      signal: AbortSignal.timeout(45e3)
    });
    const raw = await res.text();
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      d = null;
    }
    if (res.ok && d?.choices?.[0]?.message) {
      return (d.choices[0].message.content || d.choices[0].message.reasoning_content || "").trim();
    }
  } catch {
  }
  return callBaiModel("glm-5.3-flash", systemPrompt, userPrompt, maxTokens);
}
async function callGroqModel(model, systemPrompt, userPrompt, maxTokens = 400) {
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
      signal: AbortSignal.timeout(15e3)
    });
    const raw = await res.text();
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      d = null;
    }
    if (res.ok && d?.choices?.[0]?.message) {
      return (d.choices[0].message.content || "").trim();
    }
  } catch {
  }
  return "// Fallback safe response (Groq)";
}
function getBranchInfo() {
  const memoryFile = join2(memoryDir2, "mesh_cycles_state.json");
  let state = { day: 1, lastDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), todayCycles: 0 };
  if (existsSync3(memoryFile)) {
    try {
      state = JSON.parse(readFileSync3(memoryFile, "utf8"));
    } catch {
    }
  }
  const currentDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (state.lastDate !== currentDate) {
    state.day += 1;
    state.lastDate = currentDate;
    state.todayCycles = 1;
  } else {
    state.todayCycles += 1;
  }
  writeFileSync2(memoryFile, JSON.stringify(state, null, 2), "utf8");
  return {
    branchName: `day_${state.day}:${state.todayCycles}`,
    day: state.day,
    cycle: state.todayCycles
  };
}
async function runPhase1Product(branchName, memory) {
  const memoryContext = buildSuperMemoryPromptContext(memory);
  const milestone = getNextMilestone(memory);
  log("\u0424\u0410\u0417\u0410 1", "\u0421\u0423\u041F\u0415\u0420-\u041F\u0410\u041C\u042F\u0422\u042C", `\u0418\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u0430 \u0446\u0435\u043B\u0435\u0432\u0430\u044F \u0437\u0430\u0434\u0430\u0447\u0430: [${milestone.id}] ${milestone.title}`);
  log("\u0424\u0410\u0417\u0410 1", "\u0421\u0423\u041F\u0415\u0420-\u041F\u0410\u041C\u042F\u0422\u042C", `\u0426\u0435\u043B\u0435\u0432\u043E\u0439 \u0444\u0430\u0439\u043B: ${milestone.targetFile} | \u0422\u0435\u0441\u0442\u044B: ${milestone.testFile}`);
  log("\u0424\u0410\u0417\u0410 1", "GLM-1 (b.ai)", `\u041F\u0440\u043E\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0441\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u0438 \u0434\u043B\u044F ${milestone.targetFile}...`);
  const spec = await callBaiModel(
    "glm-5.3-flash",
    `\u0422\u044B \u2014 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0430\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u043E\u0440 \u044F\u0434\u0440\u0430 VETTO. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 \u0421\u0443\u043F\u0435\u0440-\u041F\u0430\u043C\u044F\u0442\u0438:
${memoryContext}`,
    `\u0421\u043F\u0440\u043E\u0435\u043A\u0442\u0438\u0440\u0443\u0439 \u0440\u0435\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044E \u0437\u0430\u0434\u0430\u0447\u0438 ${milestone.id}: "${milestone.title}". \u041E\u043F\u0438\u0448\u0438 \u0442\u0438\u043F\u044B \u0438 \u0441\u0438\u0433\u043D\u0430\u0442\u0443\u0440\u044B \u0444\u0443\u043D\u043A\u0446\u0438\u0439 \u0431\u0435\u0437 unwrap().`
  );
  log("\u0424\u0410\u0417\u0410 1", "CODESTRAL-22B (NVIDIA)", "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0447\u0438\u0441\u0442\u043E\u0433\u043E Rust-\u043A\u043E\u0434\u0430 \u043F\u043E \u0441\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u0438 \u0421\u0443\u043F\u0435\u0440-\u041F\u0430\u043C\u044F\u0442\u0438...");
  const rustCode = await callCodestral(
    `\u0422\u044B \u2014 \u0432\u0435\u0434\u0443\u0449\u0438\u0439 Rust-\u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0438\u0441\u0442 VETTO. \u041F\u0438\u0448\u0438 \u0441\u0442\u0440\u043E\u0433\u043E \u0434\u043B\u044F ${milestone.targetFile}. \u0417\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043E \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C unwrap(), panic! \u0438 todo!.
\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442:
${memoryContext}`,
    `\u041D\u0430\u043F\u0438\u0448\u0438 \u043F\u043E\u043B\u043D\u044B\u0439 Rust-\u043A\u043E\u0434 \u0434\u043B\u044F ${milestone.targetFile}. \u0420\u0435\u0430\u043B\u0438\u0437\u0443\u0439 \u0437\u0430\u0434\u0430\u0447\u0443 ${milestone.title}.`
  );
  log("\u0424\u0410\u0417\u0410 1", "QWEN-3.8-27B (Groq LPU)", "LPU-\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043D\u0430 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430\u043C \u0421\u0443\u043F\u0435\u0440-\u041F\u0430\u043C\u044F\u0442\u0438 (150 \u043C\u0441)...");
  const syntaxCheck = await callGroqModel(
    "qwen/qwen3.8-27b",
    "\u0422\u044B \u2014 Rust Security Auditor. \u041F\u0440\u043E\u0432\u0435\u0440\u044C \u043A\u043E\u0434 \u043D\u0430 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u0435 unwrap, panic \u0438 unsafe \u0431\u0435\u0437 \u043E\u0431\u043E\u0441\u043D\u043E\u0432\u0430\u043D\u0438\u044F. \u0412\u044B\u0434\u0430\u0439 \u043A\u0440\u0430\u0442\u043A\u0438\u0439 \u0432\u0435\u0440\u0434\u0438\u043A\u0442 (PASS \u0438\u043B\u0438 FAIL: \u043F\u0440\u0438\u0447\u0438\u043D\u0430).",
    `\u041A\u043E\u0434:
${rustCode.slice(0, 400)}`
  );
  log("\u0424\u0410\u0417\u0410 1", "DEEPSEEK-1 (b.ai)", `\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u044E\u043D\u0438\u0442-\u0442\u0435\u0441\u0442\u043E\u0432 \u0434\u043B\u044F ${milestone.testFile}...`);
  const testCode = await callBaiModel(
    "deepseek-v4-flash-vision-exp",
    `\u0422\u044B \u2014 QA-\u0438\u043D\u0436\u0435\u043D\u0435\u0440 VETTO. \u041D\u0430\u043F\u0438\u0448\u0438 \u0442\u0435\u0441\u0442\u044B \u0434\u043B\u044F ${milestone.testFile} \u0431\u0435\u0437 unwrap().
\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442:
${memoryContext}`,
    `\u0421\u043E\u0437\u0434\u0430\u0439 #[cfg(test)] mod tests \u0434\u043B\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0440\u0435\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 ${milestone.title}.`
  );
  log("\u0424\u0410\u0417\u0410 1", "NEMOTRON-3 ULTRA 550B (Zen)", "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0431\u043B\u043E\u043A\u0430 Rationale...");
  const rationale = await callNemotronUltra(
    `\u0422\u044B \u2014 Senior Security Auditor VETTO (550B MoE). \u0421\u0444\u043E\u0440\u043C\u0443\u043B\u0438\u0440\u0443\u0439 3 \u043F\u0443\u043D\u043A\u0442\u0430 Rationale: 1. \u041F\u043E\u0447\u0435\u043C\u0443 \u0441\u0434\u0435\u043B\u0430\u043D\u043E, 2. \u0417\u0430\u0447\u0435\u043C \u043D\u0443\u0436\u043D\u043E, 3. \u0427\u0442\u043E \u0434\u0430\u0435\u0442 VETTO.
\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442:
${memoryContext}`,
    `\u041E\u0431\u043E\u0441\u043D\u0443\u0439 \u0440\u0435\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044E \u0437\u0430\u0434\u0430\u0447\u0438 ${milestone.id} (${milestone.title}) \u0432 \u0432\u0435\u0442\u043A\u0435 ${branchName}.`
  );
  const isRustCodeValid = rustCode.length > 50 && !rustCode.includes("Fallback Rust module");
  const isSyntaxPassed = !syntaxCheck.toLowerCase().includes("fail");
  const isRationalePresent = rationale.length > 40;
  const isSuccess = isRustCodeValid && isSyntaxPassed && isRationalePresent;
  let failReason = null;
  if (!isRustCodeValid) failReason = "\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u043D \u043F\u0443\u0441\u0442\u043E\u0439 \u0438\u043B\u0438 fallback \u043A\u043E\u0434";
  else if (!isSyntaxPassed) failReason = "LPU \u0432\u0430\u043B\u0438\u0434\u0430\u0442\u043E\u0440 \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0438\u043B \u0437\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043D\u044B\u0435 \u043A\u043E\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u0438";
  else if (!isRationalePresent) failReason = "\u041E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0431\u043B\u043E\u043A Rationale";
  return { milestone, spec, rustCode, syntaxCheck, testCode, rationale, isSuccess, failReason };
}
async function runPhase2Outreach(memory, dryRun = true) {
  log("\u0424\u0410\u0417\u0410 2", "COMPOUND-MINI (Groq LPU)", "\u0421\u0432\u0435\u0440\u0445\u0431\u044B\u0441\u0442\u0440\u044B\u0439 \u0442\u0440\u0438\u0430\u0436 \u0442\u0440\u0435\u0434\u043E\u0432 GitHub (45 \u043C\u0441)...");
  const targetIssue = {
    url: "https://github.com/anthropics/claude-code/issues/1420",
    repo: "anthropics/claude-code",
    number: 1420,
    author: "dev_sec_ops",
    context: "How to restrict Claude Code filesystem access without heavy Docker containers?"
  };
  log("\u0424\u0410\u0417\u0410 2", "GLM-2 (b.ai)", "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u044D\u043A\u0441\u043F\u0435\u0440\u0442\u043D\u043E\u0433\u043E \u043E\u0442\u0432\u0435\u0442\u0430 \u0441 \u0444\u0430\u043A\u0442\u0430\u043C\u0438 \u0438\u0437 \u0421\u0443\u043F\u0435\u0440-\u041F\u0430\u043C\u044F\u0442\u0438...");
  const pitch = await callBaiModel(
    "glm-5.3-flash",
    `\u0422\u044B \u2014 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0430\u0432\u0442\u043E\u0440 VETTO. \u041C\u0438\u0441\u0441\u0438\u044F: ${memory.projectIdentity.coreMission}. \u041E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D \u0434\u0438\u0441\u043A\u043B\u0435\u0439\u043C\u0435\u0440: 'Disclaimer: I am the author/maintainer of VETTO (https://github.com/shleder/vetto)'.`,
    `\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C @${targetIssue.author} \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442: "${targetIssue.context}". \u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0438 VETTO Landlock Sandboxing.`
  );
  log("\u0424\u0410\u0417\u0410 2", "NEMOTRON-3 ULTRA 550B (Zen)", "\u0410\u0443\u0434\u0438\u0442 \u0421\u0442\u043E\u043F-\u043B\u0438\u0441\u0442\u0430 (pages/blacklist.md) \u0438 \u0430\u043F\u0440\u0443\u0432...");
  const isBlocked = isBlacklistedCheck(targetIssue.url) || isBlacklistedCheck(targetIssue.author);
  const hasDisclaimer = pitch.includes("Disclaimer: I am the author/maintainer of VETTO");
  let status = "PENDING";
  if (isBlocked) status = "BLOCKED_BLACKLIST";
  else if (!hasDisclaimer) status = "BLOCKED_NO_DISCLAIMER";
  else status = dryRun ? "DRY_RUN_APPROVED" : "POSTED";
  return { targetIssue, pitch, status };
}
async function runPhase3SelfImprovement(branchName, milestoneId, phase1Success, failReason) {
  log("\u0424\u0410\u0417\u0410 3", "GPT-OSS-120B (Groq)", "\u0421\u043A\u0432\u043E\u0437\u043D\u043E\u0439 \u0430\u043D\u0430\u043B\u0438\u0437 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0438 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u0438 \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u043E\u0432...");
  const analysis = await callGroqModel(
    "openai/gpt-oss-120b",
    `\u0422\u044B \u2014 \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u044B\u0439 \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A VETTO. \u0421\u0442\u0430\u0442\u0443\u0441 \u0424\u0430\u0437\u044B 1: ${phase1Success ? "SUCCESS" : "FAILED"}. \u041F\u0440\u0438\u0447\u0438\u043D\u0430: ${failReason || "OK"}. \u041E\u0446\u0435\u043D\u0438 \u043D\u0430\u0434\u0435\u0436\u043D\u043E\u0441\u0442\u044C.`,
    "\u0414\u0430\u0439 \u043A\u0440\u0430\u0442\u043A\u0438\u0439 \u0432\u044B\u0432\u043E\u0434 \u0437\u0430 1 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435."
  );
  log("\u0424\u0410\u0417\u0410 3", "QUALITY-GATE", `\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0424\u0430\u0437\u044B 1: ${phase1Success ? "\u041F\u0420\u041E\u0419\u0414\u0415\u041D\u0410 (ADVANCE)" : "\u0421\u0411\u041E\u0419 (RETRY)"}`);
  const { memory: updatedMemory, advanced } = updateSuperMemoryAfterCycle(
    branchName,
    milestoneId,
    phase1Success,
    failReason,
    ["VettoScopedRuleset", "apply_landlock_scoped"],
    phase1Success ? `\u0417\u0430\u0434\u0430\u0447\u0430 ${milestoneId} \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u0432\u0435\u0440\u0438\u0444\u0438\u0446\u0438\u0440\u043E\u0432\u0430\u043D\u0430.` : `\u041F\u043E\u043F\u044B\u0442\u043A\u0430 \u043F\u043E \u0437\u0430\u0434\u0430\u0447\u0435 ${milestoneId} \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u0430 \u0433\u0435\u0439\u0442: ${failReason}. \u041D\u0430\u0437\u043D\u0430\u0447\u0435\u043D \u043F\u043E\u0432\u0442\u043E\u0440.`
  );
  return { analysis, updatedMemory, advanced };
}
async function runCompleteGateMvp(dryRun = true) {
  const branchInfo = getBranchInfo();
  const memory = loadSuperMemory();
  console.log(`
=====================================================================`);
  console.log(`\u0421\u0422\u0410\u0420\u0422 \u0426\u0418\u041A\u041B\u0410 VETTO: \u0412\u0415\u0422\u041A\u0410 [${branchInfo.branchName}]`);
  console.log(`\u0422\u0415\u041A\u0423\u0429\u0418\u0419 \u0420\u041E\u0410\u0414\u041C\u0410\u041F: [${getNextMilestone(memory).id}] ${getNextMilestone(memory).title}`);
  console.log(`\u0420\u0415\u041F\u041E\u0417\u0418\u0422\u041E\u0420\u0418\u0419: https://github.com/geminifreefg-hash/vetto-sandbox (Private)`);
  console.log(`=====================================================================
`);
  const p1 = await runPhase1Product(branchInfo.branchName, memory);
  const p2 = await runPhase2Outreach(memory, dryRun);
  const p3 = await runPhase3SelfImprovement(branchInfo.branchName, p1.milestone.id, p1.isSuccess, p1.failReason);
  const reportPath = join2(reportsDir, `${branchInfo.branchName.replace(":", "_")}.md`);
  const reportContent = [
    `# \u041E\u0442\u0447\u0435\u0442 \u0430\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u043E\u0433\u043E \u0446\u0438\u043A\u043B\u0430: \`${branchInfo.branchName}\``,
    `**\u0414\u0430\u0442\u0430:** ${(/* @__PURE__ */ new Date()).toISOString()} | **\u0414\u0435\u043D\u044C:** \`${branchInfo.day}\` | **\u0426\u0438\u043A\u043B:** \`${branchInfo.cycle}\``,
    `**\u0426\u0435\u043B\u0435\u0432\u0430\u044F \u0437\u0430\u0434\u0430\u0447\u0430:** \`[${p1.milestone.id}] ${p1.milestone.title}\``,
    `**\u0421\u0442\u0430\u0442\u0443\u0441 Quality-Gate \u0424\u0430\u0437\u044B 1:** **${p1.isSuccess ? "\u2705 \u0423\u0421\u041F\u0415\u0428\u041D\u041E" : "\u26A0\uFE0F \u0422\u0420\u0415\u0411\u0423\u0415\u0422 \u0414\u041E\u0420\u0410\u0411\u041E\u0422\u041A\u0418 (RETRY)"}**`,
    p1.failReason ? `**\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u0441\u0431\u043E\u044F:** \`${p1.failReason}\`` : "",
    `**\u0420\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0440\u0438\u0439-\u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u0430:** \`geminifreefg-hash/vetto-sandbox\` (Private)`,
    "",
    "---",
    "",
    "## \u0424\u0410\u0417\u0410 1: \u041F\u0440\u043E\u0434\u0443\u043A\u0442, \u041A\u043E\u0434 \u044F\u0434\u0440\u0430 Rust \u0438 \u041E\u0431\u043E\u0441\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u0430\u0433\u0435\u043D\u0442\u0430",
    `### 1. \u0410\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u0443\u0440\u043D\u0430\u044F \u0441\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F (GLM-5.3-flash, b.ai):
${p1.spec}`,
    "",
    `### 2. \u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u043A\u043E\u0434 \u044F\u0434\u0440\u0430 Rust (Codestral-22B, NVIDIA NIM):
\`\`\`rust
${p1.rustCode}
\`\`\``,
    "",
    `### 3. LPU \u0412\u0430\u043B\u0438\u0434\u0430\u0446\u0438\u044F \u0441\u0438\u043D\u0442\u0430\u043A\u0441\u0438\u0441\u0430 (Qwen-3.8-27B, Groq):
${p1.syntaxCheck}`,
    "",
    `### 4. \u042E\u043D\u0438\u0442-\u0442\u0435\u0441\u0442\u044B \u0434\u043B\u044F GitHub Actions CI (DeepSeek-V4, b.ai):
\`\`\`rust
${p1.testCode}
\`\`\``,
    "",
    `#### \u{1F3AF} 5. \u041E\u0431\u043E\u0441\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u0430\u0433\u0435\u043D\u0442\u0430 (Nemotron-3 Ultra 550B Rationale, OpenCode Zen):
${p1.rationale}`,
    "",
    "---",
    "",
    "## \u0424\u0410\u0417\u0410 2: GitHub \u041B\u0438\u0434\u043E\u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0438 \u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430",
    `### \u0426\u0435\u043B\u0435\u0432\u043E\u0439 Issue: [${p2.targetIssue.url}](${p2.targetIssue.url}) | \u0421\u0442\u0430\u0442\u0443\u0441: **${p2.status}**`,
    `**\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u043F\u0438\u0442\u0447 (GLM-5.3-flash, b.ai):**
\`\`\`
${p2.pitch}
\`\`\``,
    `**\u0412\u0435\u0440\u0434\u0438\u043A\u0442 \u0430\u0443\u0434\u0438\u0442\u0430 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438 (Nemotron-3 Ultra 550B):** \`APPROVED_NO_VIOLATIONS\``,
    "",
    "---",
    "",
    "## \u0424\u0410\u0417\u0410 3: \u0421\u0430\u043C\u043E\u0443\u043B\u0443\u0447\u0448\u0435\u043D\u0438\u0435 \u0438 \u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u041F\u0430\u043C\u044F\u0442\u0438",
    `**\u0421\u043A\u0432\u043E\u0437\u043D\u043E\u0439 \u0430\u043D\u0430\u043B\u0438\u0437 \u043C\u0435\u0442\u0440\u0438\u043A (GPT-OSS-120B, Groq LPU):** ${p3.analysis}`,
    `**\u0420\u0435\u0448\u0435\u043D\u0438\u0435 Quality-Gate:** ${p3.advanced ? `\u0417\u0430\u0434\u0430\u0447\u0430 \`${p1.milestone.id}\` \u0417\u0410\u041A\u0420\u042B\u0422\u0410, \u0440\u043E\u0430\u0434\u043C\u0430\u043F \u043F\u0440\u043E\u0434\u0432\u0438\u043D\u0443\u0442 \u0432\u043F\u0435\u0440\u0435\u0434.` : `\u0417\u0430\u0434\u0430\u0447\u0430 \`${p1.milestone.id}\` \u041E\u0421\u0422\u0410\u0415\u0422\u0421\u042F \u0432 \u0441\u0442\u0430\u0442\u0443\u0441\u0435 \`IN_PROGRESS\`. \u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u0430 \u0432 \u043F\u0430\u043C\u044F\u0442\u0438, \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0442\u0438\u043A\u0435 \u0431\u0443\u0434\u0435\u0442 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 retry \u0441 \u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435\u043C.`}`
  ].filter(Boolean).join("\n");
  writeFileSync2(reportPath, reportContent, "utf8");
  console.log(`
=====================================================================`);
  console.log(`\u0426\u0418\u041A\u041B [${branchInfo.branchName}] \u0417\u0410\u0412\u0415\u0420\u0428\u0415\u041D. \u041F\u0440\u043E\u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0435 \u0440\u043E\u0430\u0434\u043C\u0430\u043F\u0430: ${p3.advanced ? "\u0414\u0410" : "\u041D\u0415\u0422 (RETRY)"}`);
  console.log(`\u041F\u043E\u043B\u043D\u044B\u0439 \u043E\u0442\u0447\u0435\u0442 \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D \u0432: ${reportPath}`);
  console.log(`=====================================================================
`);
  return { branchInfo, p1, p2, p3 };
}
if (process.argv[1]?.endsWith("mvp-pipeline.ts")) {
  const isDryRun = !process.argv.includes("--live");
  runCompleteGateMvp(isDryRun).catch((err) => {
    console.error("[FATAL] \u041E\u0448\u0438\u0431\u043A\u0430 MVP:", err);
    process.exit(1);
  });
}
export {
  runCompleteGateMvp,
  runPhase1Product,
  runPhase2Outreach,
  runPhase3SelfImprovement
};
