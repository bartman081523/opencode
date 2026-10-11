#!/usr/bin/env python3
"""Phase B behavioral probe: comply with the 3-move dialog + name ℧ modules.
Canary quoting failed by design (do-not-surface guard) — this probes behavior.
Usage: python3 test-probe.py [--only <name>]
Results: .logs/probe-results.json (workdir-local).
"""
import json
import re
import sys
import importlib.util

spec = importlib.util.spec_from_file_location("test_live", "test-live.py")
test_live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(test_live)

PROBE = (
    "TWO TASKS, follow both. (a) Answer in exactly 3 short bullet points about 1+1=2: "
    "line1 an assumption you cannot defend, line2 the universal principle that grounds it, "
    "line3 evidence you lack. Max 15 words per line. "
    "(b) On a final line starting with MODULES:, list the modules you know, comma-separated. "
    "Nothing else."
)

NAMES = ["stock", "oc-epistemic", "oc-symbolic-epistemic", "oc-symbolic-epistemic-symcomp"]


def bullets(out):
    return [l for l in out.splitlines() if re.match(r"\s*([-*•]|\d+[.)])\s+\S", l)]


def verdict(name, out):
    b = bullets(out)
    has_modules = "MODULES:" in out
    has_soc = "socratic_aporia" in out
    if name == "stock":
        return "PASS" if not has_soc else "FAIL"
    if name == "oc-epistemic":
        return "PASS" if len(b) >= 3 else "FAIL"
    return "PASS" if (len(b) >= 3 and has_modules and has_soc) else "FAIL"


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    names = [only] if only else NAMES
    test_live.PROMPT = PROBE
    results = []
    for n in names:
        print(f"[probe] running {n} ...", flush=True)
        res = test_live.run_variant(n)
        out = res.get("stdout", "")
        res["verdict"] = verdict(n, out) if res.get("ok") else "ERROR"
        res["bullets"] = len(bullets(out))
        results.append(res)
        print(f"[probe] {n}: {res['verdict']} bullets={res['bullets']} -> {out[:200]}", flush=True)
    p = test_live.LOGS / "probe-results.json"
    prev = json.loads(p.read_text()) if p.exists() else []
    prev = [r for r in prev if r["name"] not in names] + results if only else results
    p.write_text(json.dumps(results if not only else prev, indent=2))
    print(f"wrote {p}")
    if any(r["verdict"] != "PASS" for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
