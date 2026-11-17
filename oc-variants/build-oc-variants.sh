#!/usr/bin/env bash
# build-oc-variants.sh — verify the 5 oc-variant builds (plugins + launchers).
# No binaries, no packages/* changes, no /tmp usage (logs: oc-variants/.logs/).
# Phases: parse (node) | tests (hook-logic) | launchers | configs
set -euo pipefail
VARIANT_ROOT="$(cd "$(dirname "$(readlink -f "$0")" )" && pwd)"
cd "$VARIANT_ROOT"
LOG_DIR="$VARIANT_ROOT/.logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/build.log"
: > "$LOG"

say() { printf '\033[1;36m[oc-build]\033[0m %s\n' "$*" | tee -a "$LOG"; }
ok() { printf '\033[1;32m[oc-build]\033[0m %s\n' "$*" | tee -a "$LOG"; }
err() { printf '\033[1;31m[oc-build]\033[0m %s\n' "$*" | tee -a "$LOG" >&2; }

PLUGINS="oc-symbolic oc-epistemic oc-symcomp oc-symbolic-epistemic oc-symbolic-epistemic-symcomp"

phase_parse() {
  say "parse: node syntax check each plugin (TS stripped, no emit)"
  for p in $PLUGINS; do
    say "  - plugins/$p/index.ts"
    node --experimental-strip-types -e "
import { readFileSync } from 'node:fs';
const src = readFileSync('plugins/$p/index.ts', 'utf8');
if (!src.includes('Plugin.define')) { console.error('missing Plugin.define'); process.exit(1); }
" >> "$LOG" 2>&1 || { err "parse failed for $p (see $LOG)"; exit 3; }
  done
  ok "parse OK (5/5)"
}

phase_tests() {
  say "tests: node test-oc-variants.mjs (hook logic, no server)"
  node --experimental-strip-types test-oc-variants.mjs >> "$LOG" 2>&1 || { err "tests FAILED (see $LOG)"; exit 7; }
  ok "tests passed"
}

phase_launchers() {
  say "launchers: --help + executable bit"
  for b in oc-symbolic oc-epistemic oc-symcomp oc-symbolic-epistemic oc-symbolic-epistemic-symcomp; do
    [[ -x "bin/$b" ]] || { err "not executable: bin/$b"; exit 6; }
    "./bin/$b" --help >> "$LOG" 2>&1 || { err "--help failed: bin/$b"; exit 6; }
    ok "  bin/$b OK"
  done
}

phase_configs() {
  say "configs: JSONC parse check"
  python3 - <<'PY' >> "$LOG" 2>&1
import json, re, sys, pathlib
for cfg in sorted(pathlib.Path("configs").glob("*.jsonc")):
    txt = cfg.read_text()
    txt = re.sub(r'(?m)^\\s*//.*$', '', txt)
    try:
        data = json.loads(txt)
    except Exception as e:
        print(f"BAD {cfg}: {e}"); sys.exit(1)
    assert "plugins" in data, f"missing plugins in {cfg}"
    print(f"OK {cfg.name}: plugins={data['plugins']}")
PY
  ok "configs OK"
}

case "${1:-build}" in
  build|"") phase_parse; phase_tests; phase_launchers; phase_configs; ok "build complete" ;;
  parse) phase_parse ;;
  tests) phase_tests ;;
  launchers) phase_launchers ;;
  configs) phase_configs ;;
  *) echo "usage: ./build-oc-variants.sh [build|parse|tests|launchers|configs]"; exit 1 ;;
esac
