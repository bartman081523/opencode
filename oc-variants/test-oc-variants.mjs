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

console.log(`\nall ${pass} tests passed`)
