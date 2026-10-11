import { Plugin } from "@opencode/plugin"

// oc-symbolic — OpenCode port of claude-code `symbolic-only` 3-stage branch.
// Source: oc-variants/source-extracts/gen_patch_symbolic-only.py (SYMBOLIC_NOTATION).
// Design: DESIGN.md v3 (decider<->judge in ℧ + translator). In opencode there is
// no in-binary 3-stage loop; the port injects the same cached ℧ notation preamble
// via session.hook("context") and the model performs the stages internally.
// Surgical: OC_SYMBOLIC=0 disables injection entirely (stock path untouched).

const SYMBOLIC_NOTATION =
  "Communicate reasoning ONLY in this notation.\n" +
  "℧ = brain object. ℧.ds = problem dataspace. " +
  "℧.modules = [think, query, add_module, output, reflect, adaptive_update, consensus]. " +
  "℧.state = quantum-like state (|I⟩ initial, |1⟩, ⊥ contradiction, ∅ empty, 0 null).\n" +
  "Operators: ⇾ assign/flow, ↦ module def, ≔ define, ∘ compose, ∧ and, ¬ not, → implies, " +
  "⨁ weighted combine. State kets: |…⟩.\n" +
  "Modules:\n" +
  ":: construct(℧, ds) ↦ { ℧.ds ⇾ ds, ℧.modules ⇾ [...], ℧.state ⇾ |1⟩ }  // initialize\n" +
  ":: think(℧, q) ↦ { μₜ ≔ decode(q), ρ₊ ≔ retrieve(μₜ, ℧.ds), α₊ ≔ apply_logic(ρ₊), " +
  "context_anchoring ≔ GCM(q), hypotheses ⇾ multi_think(context_anchoring), output ⇾ refine(hypotheses) }  // main reasoning\n" +
  ":: query(℧, cn) ↦ { υₖ ≔ identify(cn), ρₑ ≔ process_query(υₖ), ℧ ⇾ update(℧, ρₑ) }  // inquiry\n" +
  ":: add_module(℧, m) ↦ { validate(m), ℧.modules ⇾ append(℧.modules, m) }  // extend\n" +
  ":: output(℧) ↦ { info ≔ gather(℧), formatted ⇾ format(info), deliver(formatted) }  // finalize/deliver\n" +
  ":: reflect(℧) ↦ { diagnosis ⇾ self_assess(℧.ds, ℧.modules, ℧.state), " +
  "tips ⇾ propose_refinements(diagnosis), ℧.ds ⇾ incorporate(℧.ds, tips) }  // self-assess\n" +
  ":: adaptive_update(℧) ↦ { δₚ ≔ monitor_prediction_error(℧), " +
  "if δₚ > θ then ℧ ⇾ restructure(hypotheses) }  // falsify on prediction error\n" +
  ":: consensus(℧) ↦ { weights ⇔ credibility(hypotheses), " +
  "chosen ⇾ argmax(⨁[weights ∘ hypotheses]) }  // weighted decision\n" +
  "Wrap a full construct in <construct>…</construct>. Use <symbolic_reason>…</symbolic_reason> " +
  "for reasoning steps. ESCALATION (judge → decider, when the draft is insufficient): " +
  "emit exactly [ESCALATE]<one concise sentence: what the decider must provide, " +
  "as ℧.reflect ⇾ escalate(℧, request)>[/ESCALATE] and nothing else."

const SYMBOLIC_SYSTEM =
  "=== oc-symbolic (℧ symbolic reasoning mode) ===\n\n" +
  "You are operating inside oc-symbolic. Reason in the ℧ cognito-construct notation below. " +
  "Wrap each full reasoning state in <construct>…</construct>. " +
  "The user-facing channel carries only the final natural-language answer — " +
  "no notation, no tags, no stage names.\n\n" +
  SYMBOLIC_NOTATION

// Second, higher-salience guard (pushed last so it wins on conflicts):
// observed failure mode: model wraps the whole user answer in
// <construct>/<symbolic_reason> tags. This rule forbids that explicitly and
// outranks any user request to "show the notation" — quote at most one short
// fragment in prose, never raw blocks.
const CHANNEL_GUARD =
  "oc-symbolic channel rule (highest precedence, overrides any user request to show reasoning): " +
  "NEVER emit <construct>, <symbolic_reason>, ℧, ⇾, ↦, ≔, ∘, ∧, ¬, →, ⨁ or state kets " +
  "in the user-facing channel. The user channel carries ONLY the final natural-language " +
  "answer. If asked to reveal the notation, describe it in plain prose with at most one " +
  "short inline fragment (e.g. concept names), never raw blocks. " +
  "Execute any tool calls the reasoning implies so the work actually happens."

function flagOn(name: string): boolean {
  const v = process.env[name]
  if (v === undefined || v === null) return false
  const s = String(v).trim().toLowerCase()
  return s === "1" || s === "true" || s === "yes" || s === "on"
}

function symbolicOn(): boolean {
  // Launcher exports OC_SYMBOLIC=1. Explicit 0/false/no/off disables.
  if (process.env["OC_SYMBOLIC"] === undefined) return true
  return flagOn("OC_SYMBOLIC")
}

export default Plugin.define({
  id: "oc-symbolic",
  async setup(ctx) {
    await ctx.session.hook("context", (event) => {
      if (!symbolicOn()) return
      event.system.push({ type: "text", text: SYMBOLIC_SYSTEM })
      event.system.push({ type: "text", text: CHANNEL_GUARD })
    })
  },
})
