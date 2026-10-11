# oc-variants — OpenCode ports of the claude-code rebuild patches

Source: `/run/media/julian/ML4/claude_code/claude-code/rebuild/` (branches
`symbolic-only`, `symbolic-only-epistemic`, `cc-symbolic-epistemic-symcomp`,
`cc-symbolic-epistemic-fixedac`).
Evidence extracts: `oc-variants/source-extracts/`.

Claude-code patches that are **claude-specific engine bugs** are
intentionally NOT ported (opencode does not have that code):
- auto-mode classifier fail-open (`AUTO_MODE_FAIL_OPEN_*` in `gen_patch*.py`)
- bg-respawn `--model` strip (`__symStripModelFlag`)
- Bun `.bun` bytecode repoint mechanics (`patch.py` repoint path)
- `thinking:{type:'disabled'}` + `max_tokens` cloud caps (Anthropic-protocol
  specific; opencode provider layer handles budgets per model)

What IS ported (reasoning content, provider-agnostic):
- `SYMBOLIC_NOTATION` (℧ cognito-construct reference, `symbolic-only` branch)
- `EPISTEMIC_PREAMBLE` reduced 1129-char version (HEAD `gen_patch.py`)
- `SYMBOLIC_DO_NOT_SURFACE` user-channel guard
- `SCIMIND_5_0_PREAMBLE` (`scimind_mandates.py`, hermes-agent `1a7bb2983`)
- symcomp auto-compact merge logic (`__symCollectConstructs`,
  `__symAutoCompactSystem`, size cap, mermaid opt-in)

## Variants (5 builds, plugins + launcher)

| # | opencode build | claude-code equivalent | content |
|---|---|---|---|
| 1 | `oc-symbolic` | `symbolic-only` 3-stage (DECIDER→JUDGE→TRANSLATOR, ℧ channel) | `SYMBOLIC_NOTATION` system injection via `session.hook("context")`. Single-request (opencode has no in-binary 3-stage loop; the notation is the cached preamble, the model does the stages internally). |
| 2 | `oc-epistemic` | `symbolic-only-epistemic` single-prompt | `EPISTEMIC_PREAMBLE` + do-not-surface note via `session.hook("context")`. |
| 3 | `oc-symcomp` | `gen_patch_symcomp.py` auto-compact half | `session.hook("compaction")` merges `<construct>` blocks into one converged `<construct>` + follow-up next-action text (bdeb3f7a fix). Standalone, layers onto stock or any variant. |
| 4 | `oc-symbolic-epistemic` (**wichtig**) | symbolic notation + epistemic dialog combined | `SYMBOLIC_NOTATION` + `EPISTEMIC_PREAMBLE` + do-not-surface, one `context` hook. |
| 5 | `oc-symbolic-epistemic-symcomp` | full stack | variant 4 + variant 3 compaction hook. |

Each variant: `plugins/<name>/index.ts` (self-contained, no imports beyond
`@opencode/plugin`), `configs/<name>.jsonc` (reference), `bin/oc-<name>`
(launcher, sets `OPENCODE_CONFIG_CONTENT` + `OC_*` env defaults, then
`exec opencode "$@"`).

## Env gates (surgical opt-out, default ON via launcher)

- `OC_SYMBOLIC=0` disables symbolic notation injection
- `OC_EPISTEMIC=0` disables epistemic dialog injection
- `OC_SYMCOMP=0` disables symbolic auto-compact (falls back to stock summary)
- `OC_SYMCOMP_MERMAID=1` adds Mermaid rendering to the compact prompt (off default)
- `OC_SYMCOMP_MAX_BYTES` caps prior-construct prompt bytes (default 24576)
- `OC_DEBUG=1` logs hook activity to `oc-variants/.logs/<variant>.log` (workdir-local, no /tmp)

## Build / verify

`./build-oc-variants.sh` (in `oc-variants/`): typechecks each plugin with
`bun build --target=bun` (no emit, just parse) + runs `test-oc-variants.mjs`
hook-logic tests (pure functions, no server needed) + validates each launcher
is executable and each config is valid JSONC.

No compiled binaries. No changes to `packages/*`. No `/tmp` usage.

## Live tests (2026-10-11, model `opencode/muse-spark-1.3-contributor-free`)

- `test-live.py` (canary): stock PASS (NONE); oc-symbolic PASS
  (model answers in `<construct><symbolic_reason>℧…` notation);
  oc-symcomp PASS (NONE by design, no context hook);
  gate `OC_SYMBOLIC_EPISTEMIC=0+OC_SYMCOMP=0` PASS (NONE).
  Epistemic variants refuse quoting (`I can't share system instructions`) —
  that IS the do-not-surface guard working, verified positively in Phase B.
- `test-probe.py` (behavioral, 4/4 PASS): stock `MODULES: none`; oc-epistemic
  3 bullets + `MODULES: default`; oc-symbolic-epistemic + fullstack 3 bullets
  + full ℧ list (`think, query, …, socratic_aporia, platonic_core,
  aristotelian_induction`).
- `test-compact.py` (live server compaction, 3/3 PASS): stock prose summary,
  no marker; oc-symcomp + fullstack store the symbolic auto-compact summary
  (`SYMBOLIC AUTO-COMPACT` marker present).
- `test-hle.py` (5 hardest local HLE tasks, 6 configs, 28/30 PASS):

| config | math-001 | math-004 | math-005 | phil-001 | phil-003 | total |
|---|---|---|---|---|---|---|
| stock | PASS | PASS | PASS | PASS* | PASS | 5/5 |
| oc-symbolic | FAIL | PASS | PASS | FAIL | PASS | 3/5 |
| oc-epistemic | PASS | PASS | PASS | PASS | PASS | 5/5 |
| oc-symcomp | PASS | PASS | PASS | PASS | PASS | 5/5 |
| oc-symbolic-epistemic | PASS | PASS | PASS | PASS | PASS | 5/5 |
| oc-symbolic-epistemic-symcomp | PASS | PASS | PASS | PASS | PASS | 5/5 |

  \* stock/phil-001 needed a `jtb` grader alias (model abbreviated correctly).
  oc-symbolic/math-001: reasoning correct (finds 8, verifies divisors) but
  emits ONLY the construct block — no FINAL, no NL (channel-leak persists
  despite the hardened guard on this model). oc-symbolic/philosophy-001:
  preamble-only stub, no answer. Conclusion: pure-℧ instruction is
  model-sensitive on muse-spark-free; the combined variants (with
  do-not-surface + SciMind) hold channel discipline 5/5. cais/hle full set
  is gated (401, no HF login) — re-run there once access is granted.
- `build-oc-variants.sh build`: parse 5/5, unit 39/39, launchers 5/5, configs 5/5.
