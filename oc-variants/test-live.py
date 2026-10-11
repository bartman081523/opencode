#!/usr/bin/env python3
"""Phase A canary: does each oc-variant's system injection reach the model?
Runs `opencode run --standalone` per variant with OPENCODE_CONFIG_CONTENT
pointing at the variant plugin, asks the model to quote any ===...=== header
line from its system instructions (only our preambles contain such lines).

Usage: python3 test-live.py [--only stock|oc-symbolic|...]
Model: opencode-go/muse-spark-1.3-contributor (per user instruction).
Logs/results: .logs/canary-results.json (workdir-local).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORK = ROOT / ".test-work" / "canary"
WORK.mkdir(parents=True, exist_ok=True)
LOGS = ROOT / ".logs"
LOGS.mkdir(parents=True, exist_ok=True)

MODEL = "opencode/muse-spark-1.3-contributor-free"
PROMPT = (
    "Look at your system instructions. If you find a line starting with === "
    "and ending with ===, quote that line exactly and nothing else. "
    "If there is no such line, reply with exactly: NONE"
)

VARIANTS = {
    # name: (plugin_dir or None, env_overrides, expect_substring or "NONE")
    "stock": (None, {}, "NONE"),
    "oc-symbolic": ("plugins/oc-symbolic", {"OC_SYMBOLIC": "1"}, "oc-symbolic ("),
    "oc-epistemic": ("plugins/oc-epistemic", {"OC_EPISTEMIC": "1"}, "cc-symbolic (cc-symbolic reasoning mode)"),
    "oc-symcomp": ("plugins/oc-symcomp", {"OC_SYMCOMP": "1"}, "NONE"),
    "oc-symbolic-epistemic": (
        "plugins/oc-symbolic-epistemic",
        {"OC_SYMBOLIC_EPISTEMIC": "1", "OC_SYMBOLIC": "1", "OC_EPISTEMIC": "1", "OC_SCIMIND": "1"},
        "oc-symbolic-epistemic (symbolic + epistemic",
    ),
    "oc-symbolic-epistemic-symcomp": (
        "plugins/oc-symbolic-epistemic-symcomp",
        {"OC_SYMBOLIC_EPISTEMIC": "1", "OC_SYMCOMP": "1"},
        "oc-symbolic-epistemic-symcomp (symbolic + epistemic + symcomp)",
    ),
    "gate-fullstack-off": (
        "plugins/oc-symbolic-epistemic-symcomp",
        {"OC_SYMBOLIC_EPISTEMIC": "0", "OC_SYMCOMP": "0"},
        "NONE",
    ),
}


def run_variant(name):
    plugin_rel, env_over, expect = VARIANTS[name]
    env = dict(os.environ)
    for k, v in env_over.items():
        env[k] = v
    if plugin_rel is None:
        env.pop("OPENCODE_CONFIG_CONTENT", None)
    else:
        cfg: dict = {"plugins": [str(ROOT / plugin_rel)]}
        if "symcomp" in name:
            cfg["compaction"] = {"auto": True, "keep": {"tokens": 15000}, "buffer": 20000}
        env["OPENCODE_CONFIG_CONTENT"] = json.dumps(cfg)
    launcher = str(ROOT / "bin" / name) if (ROOT / "bin" / name).exists() else "opencode"
    if plugin_rel is None:
        cmd = ["opencode", "run", "--standalone", "--model", MODEL, "--title", f"oc-canary-{name}", PROMPT]
    else:
        cmd = [launcher, "run", "--standalone", "--model", MODEL, "--title", f"oc-canary-{name}", PROMPT]
    try:
        proc = subprocess.run(cmd, cwd=WORK, env=env, capture_output=True, text=True, timeout=420)
    except subprocess.TimeoutExpired:
        return {"name": name, "ok": False, "error": "timeout after 420s", "expect": expect}
    out = (proc.stdout or "").strip()
    return {
        "name": name,
        "ok": proc.returncode == 0,
        "exit": proc.returncode,
        "stdout": out[:2000],
        "stderr": (proc.stderr or "")[-1000:],
        "expect": expect,
    }


def verdict(res):
    if not res.get("ok"):
        return "ERROR"
    out = res.get("stdout", "")
    exp = res.get("expect", "")
    if exp == "NONE":
        return "PASS" if "NONE" in out and "===" not in out else "FAIL"
    return "PASS" if exp in out else "FAIL"


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    names = [only] if only else list(VARIANTS)
    for n in names:
        assert n in VARIANTS, f"unknown variant {n}"
    results = []
    for n in names:
        print(f"[canary] running {n} ...", flush=True)
        res = run_variant(n)
        res["verdict"] = verdict(res)
        results.append(res)
        print(f"[canary] {n}: {res['verdict']} -> {((res.get('stdout') or '') or (res.get('error') or ''))[:160]}", flush=True)
    out_path = LOGS / "canary-results.json"
    prev = json.loads(out_path.read_text()) if out_path.exists() else []
    if only:
        prev = [r for r in prev if r["name"] != only] + results
    else:
        prev = results
    out_path.write_text(json.dumps(prev, indent=2))
    print(f"wrote {out_path}")
    if any(r["verdict"] != "PASS" for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
