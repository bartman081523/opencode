// test-oc-variants.mjs — hook-logic tests for the 5 oc-variant plugins.
// No server, no network, no /tmp. Run: node test-oc-variants.mjs
// Part 1 mirrors the pure symcomp functions (documented duplication).
// Part 2 functionally loads each plugin with a stubbed @opencode/plugin
// (type-stripped via node --experimental-strip-types) and drives the
// registered hooks with a fake ctx — real verification, not just markers.
import assert from "node:assert/strict"
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
let pass = 0
const check = (name, fn) => {
  fn()
  pass++
  console.log(`ok - ${name}`)
}

// --- mirrors (must match plugin sources) ---
function collectConstructs(messages) {
  const out = []
  let total = 0
  let turns = 0
  for (const m of messages ?? []) {
    if (!m || m.role !== "assistant") continue
    turns++
    let text = ""
    const content = m.content ?? []
    if (typeof content === "string") text = content
    else for (const blk of content) {
      if (!blk) continue
      if (blk.type === "text" && blk.text) text += "\n" + blk.text
      else if (blk.type === "thinking" && blk.thinking) text += "\n" + blk.thinking
    }
    if (!text) continue
    const re = /<construct>([\s\S]*?)<\/construct>/g
    let match
    while ((match = re.exec(text)) !== null) {
      const c = match[1]
      if (c && c.trim().length > 0) { out.push(c); total += c.length }
    }
  }
  return { constructs: out, turnCount: turns, totalChars: total }
}

function buildSummary(collected, capBytes) {
  const c = collected.constructs
  const total = c.length
  let dropped = 0
  const kept = []
  let used = 0
  const headerOverhead = "=== PRIOR CONSTRUCTS ===\n\n".length + 2
  let available = capBytes - headerOverhead
  if (available < 1024) available = 1024
  for (let k = c.length - 1; k >= 0; k--) {
    const idxStr = `${k + 1}/${total}`
    const entryLen = '<construct index="'.length + idxStr.length + '"></construct>'.length + 2 + c[k].length
    if (used + entryLen > available) { dropped = k + 1; break }
    used += entryLen
    kept.unshift(c[k])
  }
  return { kept: kept.length, dropped, total }
}

// --- tests ---
check("collect: two assistant turns, one construct each", () => {
  const r = collectConstructs([
    { role: "assistant", content: [{ type: "thinking", thinking: "x <construct>A</construct> y" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "text", text: "<construct>B</construct>" }] },
  ])
  assert.equal(r.constructs.length, 2)
  assert.equal(r.turnCount, 2)
})

check("collect: ignores user turns, skips empty constructs", () => {
  const r = collectConstructs([
    { role: "user", content: [{ type: "text", text: "<construct>U</construct>" }] },
    { role: "assistant", content: [{ type: "text", text: "<construct>  </construct>" }] },
  ])
  assert.equal(r.constructs.length, 0)
  assert.equal(r.turnCount, 1)
})

check("collect: multiple constructs per turn kept", () => {
  const r = collectConstructs([
    { role: "assistant", content: [{ type: "text", text: "<construct>1</construct> mid <construct>2</construct>" }] },
  ])
  assert.equal(r.constructs.length, 2)
})

check("cap: small cap drops oldest, keeps newest", () => {
  const big = "x".repeat(5000)
  const r = buildSummary({ constructs: [big, big, big], turnCount: 3, totalChars: 15000 }, 8000)
  assert.ok(r.dropped > 0)
  assert.ok(r.kept >= 1)
})

check("cap: large cap keeps all", () => {
  const r = buildSummary({ constructs: ["a", "b"], turnCount: 2, totalChars: 2 }, 24576)
  assert.equal(r.dropped, 0)
  assert.equal(r.kept, 2)
})

check("cap: empty constructs -> zero kept, zero dropped", () => {
  const r = buildSummary({ constructs: [], turnCount: 5, totalChars: 0 }, 24576)
  assert.equal(r.kept, 0)
  assert.equal(r.dropped, 0)
})

// --- source-presence checks (plugins contain the ported content) ---
const mustContain = {
  "plugins/oc-symbolic/index.ts": ["SYMBOLIC_NOTATION", 'hook("context"', "OC_SYMBOLIC"],
  "plugins/oc-epistemic/index.ts": ["EPISTEMIC_PREAMBLE", "DO_NOT_SURFACE", 'hook("context"', "OC_EPISTEMIC"],
  "plugins/oc-symcomp/index.ts": ['hook("compaction"', "collectConstructs", "OC_SYMCOMP", "bdeb3f7a"],
  "plugins/oc-symbolic-epistemic/index.ts": ["SYMBOLIC_NOTATION", "EPISTEMIC_PREAMBLE", "SCIMIND_MANDATES", "OC_SYMBOLIC_EPISTEMIC"],
  "plugins/oc-symbolic-epistemic-symcomp/index.ts": ['hook("context"', 'hook("compaction"', "OC_SYMCOMP", "OC_SYMBOLIC_EPISTEMIC"],
}
for (const [file, markers] of Object.entries(mustContain)) {
  check(`source ${file} exists + markers`, () => {
    const p = path.join(root, file)
    assert.ok(existsSync(p), `missing ${file}`)
    const src = readFileSync(p, "utf8")
    for (const m of markers) assert.ok(src.includes(m), `${file} missing marker: ${m}`)
  })
}

const launchers = ["oc-symbolic", "oc-epistemic", "oc-symcomp", "oc-symbolic-epistemic", "oc-symbolic-epistemic-symcomp"]
for (const b of launchers) {
  check(`launcher bin/${b} references plugin`, () => {
    const src = readFileSync(path.join(root, "bin", b), "utf8")
    assert.ok(src.includes("OPENCODE_CONFIG_CONTENT"), `${b} missing config export`)
    assert.ok(src.includes("exec opencode"), `${b} missing exec`)
  })
}

// --- functional plugin loading (stub @opencode/plugin, fake ctx) ---
function makeCtx() {
  const hooks = {}
  return {
    hooks,
    session: {
      hook(name, fn) {
        hooks[name] = hooks[name] ?? []
        hooks[name].push(fn)
        return Promise.resolve({ dispose: async () => {} })
      },
    },
  }
}

async function loadPlugin(dir) {
  const srcPath = path.join(root, "plugins", dir, "index.ts")
  const src = readFileSync(srcPath, "utf8")
  const stubbed = src.replace(
    /import\s*\{\s*Plugin\s*\}\s*from\s*["']@opencode\/plugin["']\s*/,
    "const Plugin = { define: (d) => d };",
  )
  const outDir = path.join(root, ".logs", "_load")
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${dir}.ts`)
  writeFileSync(outPath, stubbed)
  const mod = await import(pathToFileURL(outPath).href + `?t=${Date.now()}`)
  return mod.default
}

const fakeMessages = [
  { role: "assistant", content: [{ type: "thinking", thinking: "prior <construct>STATE-A</construct>" }] },
  { role: "user", content: [{ type: "text", text: "continue" }] },
  { role: "assistant", content: [{ type: "text", text: "did <construct>STATE-B</construct> done" }] },
]

for (const dir of ["oc-symbolic", "oc-epistemic", "oc-symbolic-epistemic"]) {
  const plugin = await loadPlugin(dir)
  const ctx = makeCtx()
  await plugin.setup(ctx)
  const ev = { system: [], tools: {}, options: {} }
  for (const fn of ctx.hooks["context"] ?? []) await fn(ev)
  check(`functional ${dir}: context hook injects system`, () => {
    assert.ok(ev.system.length >= 1, `${dir} injected nothing`)
    const joined = ev.system.map((s) => s.text).join("\n")
    assert.ok(joined.length > 200, `${dir} system too short`)
  })
}

for (const dir of ["oc-symcomp", "oc-symbolic-epistemic-symcomp"]) {
  const plugin = await loadPlugin(dir)
  const ctx = makeCtx()
  await plugin.setup(ctx)
  const ev = { system: [], tools: {}, options: {}, messages: fakeMessages }
  for (const fn of ctx.hooks["compaction"] ?? []) await fn(ev)
  check(`functional ${dir}: compaction hook merges constructs`, () => {
    assert.ok(ev.result && typeof ev.result.summary === "string", `${dir} no summary`)
    assert.ok(ev.result.summary.includes("<construct"), `${dir} summary has no construct`)
    assert.ok(ev.result.summary.includes("Next:") || ev.result.summary.includes("next action"), `${dir} missing follow-up`)
  })
}

{
  // fullstack context half
  const plugin = await loadPlugin("oc-symbolic-epistemic-symcomp")
  const ctx = makeCtx()
  await plugin.setup(ctx)
  const ev = { system: [], tools: {}, options: {} }
  for (const fn of ctx.hooks["context"] ?? []) await fn(ev)
  check("functional oc-symbolic-epistemic-symcomp: context has epistemic+scimind", () => {
    const joined = ev.system.map((s) => s.text).join("\n")
    assert.ok(joined.includes("EPISTEMIC DIALOG"), "missing dialog")
    assert.ok(joined.includes("SciMind") || joined.includes("Core Mandates"), "missing scimind")
  })
}

// --- env-gate matrix (surgical opt-out per variant) ---
async function driveContext(dir, env) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    const plugin = await loadPlugin(dir)
    const ctx = makeCtx()
    await plugin.setup(ctx)
    const ev = { system: [], tools: {}, options: {} }
    for (const fn of ctx.hooks["context"] ?? []) await fn(ev)
    return ev.system.map((s) => s.text).join("\n")
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

async function driveCompaction(dir, env, messages) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    const plugin = await loadPlugin(dir)
    const ctx = makeCtx()
    await plugin.setup(ctx)
    const ev = { system: [], tools: {}, options: {}, messages }
    for (const fn of ctx.hooks["compaction"] ?? []) await fn(ev)
    return ev.result?.summary ?? null
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

{
  const off = await driveContext("oc-symbolic", { OC_SYMBOLIC: "0" })
  check("gate oc-symbolic OC_SYMBOLIC=0 injects nothing", () => {
    assert.equal(off, "")
  })
  const on = await driveContext("oc-symbolic", { OC_SYMBOLIC: undefined })
  check("gate oc-symbolic default-on includes channel guard", () => {
    assert.ok(on.includes("CHANNEL_GUARD") || on.includes("highest precedence"), "missing channel guard")
    assert.ok(on.includes("NEVER emit <construct>"), "missing never-emit rule")
  })
}
{
  const off = await driveContext("oc-epistemic", { OC_EPISTEMIC: "0" })
  check("gate oc-epistemic OC_EPISTEMIC=0 injects nothing", () => {
    assert.equal(off, "")
  })
  const on = await driveContext("oc-epistemic", { OC_EPISTEMIC: undefined })
  check("gate oc-epistemic header renamed to oc-epistemic", () => {
    assert.ok(on.includes("=== oc-epistemic (epistemic reasoning mode) ==="), "header not renamed")
    assert.ok(on.includes("operating inside oc-epistemic"), "body not renamed")
    assert.ok(!on.includes("operating inside cc-symbolic"), "cc-symbolic leftover in body")
  })
}
{
  const master = await driveContext("oc-symbolic-epistemic", { OC_SYMBOLIC_EPISTEMIC: "0" })
  check("gate symbolic-epistemic master=0 injects nothing", () => {
    assert.equal(master, "")
  })
  const nosci = await driveContext("oc-symbolic-epistemic", { OC_SCIMIND: "0" })
  check("gate symbolic-epistemic OC_SCIMIND=0 drops mandates only", () => {
    assert.ok(nosci.includes("EPISTEMIC DIALOG"), "dialog missing")
    assert.ok(!nosci.includes("SciMind"), "mandates leaked")
  })
  const noepi = await driveContext("oc-symbolic-epistemic", { OC_EPISTEMIC: "0" })
  check("gate symbolic-epistemic OC_EPISTEMIC=0 drops dialog+surface-note", () => {
    assert.ok(!noepi.includes("EPISTEMIC DIALOG"), "dialog leaked")
  })
}
{
  const off = await driveCompaction("oc-symcomp", { OC_SYMCOMP: "0" }, fakeMessages)
  check("gate oc-symcomp OC_SYMCOMP=0 sets no result", () => {
    assert.equal(off, null)
  })
  const tiny = await driveCompaction(
    "oc-symcomp",
    { OC_SYMCOMP_MAX_BYTES: "1500" },
    [{ role: "assistant", content: [{ type: "text", text: "<construct>A</construct>" }] }],
  )
  check("symcomp tiny cap still yields one construct slot", () => {
    assert.ok(tiny && tiny.includes("<construct"), "no construct in summary")
  })
  const bad = await driveCompaction(
    "oc-symcomp",
    { OC_SYMCOMP_MAX_BYTES: "garbage" },
    [{ role: "assistant", content: [{ type: "text", text: "<construct>A</construct>" }] }],
  )
  check("symcomp invalid cap falls back to default", () => {
    assert.ok(bad && bad.includes("<construct"), "no construct with bad cap")
    assert.ok(!bad.includes("elided"), "unexpected elision at default cap")
  })
}

// --- pure-logic edge cases ---
check("collect: string-content assistant message", () => {
  const r = collectConstructs([{ role: "assistant", content: "think <construct>S</construct> end" }])
  assert.equal(r.constructs.length, 1)
  assert.equal(r.constructs[0], "S")
})

check("collect: thinking-only block collected, order oldest-first", () => {
  const r = collectConstructs([
    { role: "assistant", content: [{ type: "thinking", thinking: "<construct>FIRST</construct>" }] },
    { role: "assistant", content: [{ type: "text", text: "<construct>SECOND</construct>" }] },
  ])
  assert.deepEqual(r.constructs, ["FIRST", "SECOND"])
})

check("collect: malformed unclosed tag ignored", () => {
  const r = collectConstructs([{ role: "assistant", content: [{ type: "text", text: "<construct>oops" }] }])
  assert.equal(r.constructs.length, 0)
})

// mirror of renderMermaid in plugins/oc-symcomp (+fullstack): same algorithm,
// tested here because @opencode/plugin only resolves inside the runtime.
function renderMermaid(constructs) {
  if (!constructs.length) return "```mermaid\ngraph LR\n  empty[\"(no prior constructs)\"]\n```"
  const lines = ["```mermaid", "graph LR"]
  for (let i = 0; i < constructs.length; i++) {
    let label = String(constructs[i] ?? "")
      .replace(/[^a-zA-Z0-9 _|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (label.length > 40) label = label.slice(0, 39) + "…"
    if (!label) label = "(empty)"
    label = label.replace(/"/g, '\\"')
    lines.push(`  C${i}["${label}"]`)
  }
  for (let k = 0; k < constructs.length - 1; k++) lines.push(`  C${k} --> C${k + 1}`)
  lines.push("```")
  return lines.join("\n")
}

check("mermaid: empty renders placeholder node", () => {
  const m = renderMermaid([])
  assert.ok(m.includes('empty["(no prior constructs)"]'), "placeholder missing")
})

check("mermaid: chain arrows link consecutive constructs", () => {
  const m = renderMermaid(["alpha state", "beta state"])
  assert.ok(m.includes('C0["alpha state"]'), "node 0 missing")
  assert.ok(m.includes("C0 --> C1"), "chain arrow missing")
})

check("mermaid: long labels truncated, quotes stripped", () => {
  const m = renderMermaid(['x'.repeat(100) + '"quoted"'])
  const line = m.split("\n").find((l) => l.startsWith("  C0"))
  assert.ok(line.length <= 60, `label not truncated: ${line.length}`)
  assert.ok(!line.includes('"quoted"'), "raw quotes leaked")
})

check("mermaid: non-ascii stripped for lexer safety", () => {
  const m = renderMermaid(["℧.state ⇾ |1⟩"])
  assert.ok(!m.includes("℧"), "non-ascii leaked into mermaid")
})

console.log(`\nall ${pass} tests passed`)
