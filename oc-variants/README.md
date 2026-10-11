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
