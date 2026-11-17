import { Plugin } from "@opencode/plugin"

// oc-symcomp — OpenCode port of claude-code symbolic auto-compact
// (rebuild/gen_patch_symcomp.py: __symCollectConstructs, __symAutoCompactSystem,
// size cap, mermaid opt-in, follow-up next-action text = bdeb3f7a fix).
// Standalone: layers onto stock or any variant. Intercepts the compaction
// request and supplies a merged <construct> summary so the next turn finds
// constructs in history and keeps reasoning symbolically.
// Surgical: OC_SYMCOMP=0 disables (stock summary path untouched).

function flagOn(name: string): boolean {
  const v = process.env[name]
  if (v === undefined || v === null) return false
  const s = String(v).trim().toLowerCase()
  return s === "1" || s === "true" || s === "yes" || s === "on"
}

function symcompOn(): boolean {
  if (process.env["OC_SYMCOMP"] === undefined) return true
  return flagOn("OC_SYMCOMP")
}

function maxBytes(): number {
  const n = parseInt(process.env["OC_SYMCOMP_MAX_BYTES"] ?? "", 10)
  if (Number.isFinite(n) && n >= 1024) return n
  return 24 * 1024
}

function messageText(msg: any): string {
  let out = ""
  const content = msg?.content ?? []
  if (typeof content === "string") return content
  for (const blk of content) {
    if (!blk) continue
    if (blk.type === "text" && blk.text) out += "\n" + blk.text
    else if (blk.type === "thinking" && blk.thinking) out += "\n" + blk.thinking
  }
  return out
}

function collectConstructs(messages: Array<any>): { constructs: Array<string>; turnCount: number; totalChars: number } {
  const out: Array<string> = []
  let total = 0
  let turns = 0
  for (const m of messages ?? []) {
    if (!m || m.role !== "assistant") continue
    turns++
    const text = messageText(m)
    if (!text) continue
    const re = /<construct>([\s\S]*?)<\/construct>/g
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const c = match[1]
      if (c && c.trim().length > 0) {
        out.push(c)
        total += c.length
      }
    }
  }
  return { constructs: out, turnCount: turns, totalChars: total }
}

function renderMermaid(constructs: Array<string>): string {
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

function buildSymcompSummary(
  collected: { constructs: Array<string>; turnCount: number; totalChars: number },
  mermaid: boolean,
  capBytes: number,
): string {
  const c = collected.constructs
  const total = c.length
  let priorBlock: string
  let dropped = 0
  if (c.length > 0) {
    const kept: Array<string> = []
    let used = 0
    const headerOverhead = "=== PRIOR CONSTRUCTS ===\n\n".length + 2
    let available = capBytes - headerOverhead
    if (available < 1024) available = 1024
    for (let k = c.length - 1; k >= 0; k--) {
      const idxStr = `${k + 1}/${total}`
      const entryLen = '<construct index="'.length + idxStr.length + '"></construct>'.length + 2 + c[k].length
      if (used + entryLen > available) {
        dropped = k + 1
        break
      }
      used += entryLen
      kept.unshift(c[k])
    }
    if (dropped > 0) {
      priorBlock =
        `[... ${dropped} earlier construct(s) elided to fit ${capBytes} byte cap ...]\n\n` +
        kept.map((b, i) => `<construct index="${dropped + i + 1}/${total}">\n${b}\n</construct>`).join("\n\n")
    } else {
      priorBlock = kept.map((b, i) => `<construct index="${i + 1}/${total}">\n${b}\n</construct>`).join("\n\n")
    }
  } else {
    priorBlock = "(no prior constructs — emit a fresh one capturing the conversation state)"
  }
  let summary =
    "=== oc-symcomp SYMBOLIC AUTO-COMPACT ===\n\n" +
    `The prior conversation had ${collected.turnCount} turn(s) with ${collected.totalChars} chars of ` +
    "`<construct>` reasoning" +
    (dropped > 0 ? ` (${collected.constructs.length} collected; ${dropped} elided to fit prompt cap; showing recent)` : "") +
    ".\n\n" +
    "Produce a SINGLE `<construct>...</construct>` block capturing the CONVERGED EPISTEMIC STATE. " +
    "Use the same ℧ notation as the prior constructs. The merged construct must be self-contained — " +
    "a reader with only this construct (and the next user turn) continues without losing context.\n\n" +
    "=== PRIOR CONSTRUCTS ===\n\n" +
    priorBlock +
    "\n\n=== INSTRUCTIONS ===\n\n" +
    "1. Emit a SINGLE `<construct>...</construct>` block with the converged state, then a BRIEF " +
    'follow-up (1-3 sentences) stating the IMMEDIATE next action (e.g. "Next: Read /path/to/file ' +
    'with offset/limit, then analyze."). The follow-up primes the next turn to call tools; without it ' +
    "the next turn defaults to text-only (bdeb3f7a fix).\n" +
    "2. Merge prior constructs into ONE comprehensive construct; prefer the most recent / " +
    "most-evidence-supported state on disagreement.\n" +
    "3. Use ℧ notation (state kets, operators, modules) so the next turn pattern-matches it.\n" +
    "4. The construct + follow-up replace the prior conversation (same assistant message, two text " +
    "blocks in order). tool_use blocks are NOT required here; the follow-up MUST name the concrete " +
    "next action.\n"
  if (dropped > 0)
    summary +=
      `5. NOTE: ${dropped} earlier constructs were elided to fit the prompt cap. ` +
      "Preserve converged facts (current state, recent decisions, pending tasks); drop tangential details.\n"
  if (mermaid) summary += "\n=== MERMAID (reference, do not update) ===\n\n" + renderMermaid(collected.constructs) + "\n"
  return summary
}

export default Plugin.define({
  id: "oc-symcomp",
  async setup(ctx) {
    await ctx.session.hook("compaction", async (event) => {
      if (!symcompOn()) return
      const collected = collectConstructs(event.messages as Array<any>)
      const summary = buildSymcompSummary(collected, flagOn("OC_SYMCOMP_MERMAID"), maxBytes())
      event.result = { summary }
    })
  },
})
