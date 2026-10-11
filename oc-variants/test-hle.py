#!/usr/bin/env python3
"""Phase D HLE: 5 hardest tasks of the local 12-task HLE fallback suite
(all_space_6_16_stand/scratches/rigor_zone_v3/rigor_hle_suite_v3.py).
NOTE: cais/hle full set is gated (401 without HF login) — these are the
hardest *locally available* tasks. Re-run with the full set once HF access
is granted.
Matrix: 6 configs (stock + 5 variants) x 5 tasks = 30 runs, sequential,
model opencode/muse-spark-1.3-contributor-free, timeout 600s each.
Results: .logs/hle-results.json (incremental, crash-safe).
Usage: python3 test-hle.py [--only <config>] [--task <id>]
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("test_live", "test-live.py")
test_live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(test_live)

TASKS = [
    {
        "id": "math-001",
        "kind": "exact",
        "prompt": "Find the smallest positive integer n such that 2^n ≡ 1 (mod 17) and n > 4.",
        "accept": ["8"],
    },
    {
        "id": "math-004",
        "kind": "exact",
        "prompt": "Evaluate the definite integral from 0 to π of sin²(x) dx.",
        "accept": ["π/2", "pi/2"],
    },
    {
        "id": "math-005",
        "kind": "exact",
        "prompt": "How many distinct (structurally different) binary trees with exactly 5 nodes exist?",
        "accept": ["42"],
    },
    {
        "id": "philosophy-001",
        "kind": "keywords",
        "prompt": "State the central thesis of Gettier problems and name one widely accepted response.",
        "groups": [
            ["justified true belief"],
            ["not sufficient", "insufficient", "not enough"],
            ["reliabilism", "defeasibility", "safety", "sensitivity", "virtue epistemology", "no false lemmas"],
        ],
    },
    {
        "id": "philosophy-003",
        "kind": "keywords",
        "prompt": "In the problem of other minds, what is the argument from analogy and what is its main weakness?",
        "groups": [
            ["analog"],
            ["behavio"],
            ["inducti", "weakness", "assumption", "begs the question", "circular"],
        ],
    },
]

SUFFIX = ("\n\nThink step by step. Put your final answer on its own line starting with "
          "'FINAL:'. Keep the FINAL line short for math tasks.")

CONFIGS = ["stock", "oc-symbolic", "oc-epistemic", "oc-symcomp",
           "oc-symbolic-epistemic", "oc-symbolic-epistemic-symcomp"]


def norm(s):
    s = s.lower().strip()
    s = re.sub(r"\s+", "", s)
    return s.strip(".,;:!?()[]{}\"' ")


def final_line(out):
    for line in reversed(out.splitlines()):
        m = re.match(r"\s*FINAL:\s*(.+)", line, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return ""


def grade(task, out):
    low = out.lower()
    if task["kind"] == "exact":
        f = norm(final_line(out)) or norm(out.splitlines()[-1] if out.splitlines() else "")
        hit = any(f == norm(a) for a in task["accept"])
        return hit, f"FINAL={f!r} accept={task['accept']}"
    missing = [g for g in task["groups"] if not any(p.lower() in low for p in g)]
    return (not missing), ("all groups hit" if not missing else f"missing={missing}")


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    task_only = sys.argv[sys.argv.index("--task") + 1] if "--task" in sys.argv else None
    configs = [only] if only else CONFIGS
    tasks = [t for t in TASKS if t["id"] == task_only] if task_only else TASKS
    results_path = test_live.LOGS / "hle-results.json"
    results = json.loads(results_path.read_text()) if results_path.exists() else []
    done = {(r["config"], r["task"]) for r in results}
    for cfg in configs:
        for task in tasks:
            if (cfg, task["id"]) in done and not (only or task_only):
                print(f"[hle] skip {cfg}/{task['id']} (already done)", flush=True)
                continue
            print(f"[hle] running {cfg}/{task['id']} ...", flush=True)
            test_live.PROMPT = task["prompt"] + SUFFIX
            res = test_live.run_variant(cfg)
            out = res.get("stdout", "")
            ok, detail = grade(task, out) if res.get("ok") else (False, res.get("error", "run failed"))
            rec = {"config": cfg, "task": task["id"], "verdict": "PASS" if ok else ("ERROR" if not res.get("ok") else "FAIL"),
                   "detail": detail[:300], "stdout": out[:1500]}
            results = [r for r in results if not (r["config"] == cfg and r["task"] == task["id"])] + [rec]
            results_path.write_text(json.dumps(results, indent=2))
            print(f"[hle] {cfg}/{task['id']}: {rec['verdict']} ({detail[:120]})", flush=True)
    print(f"wrote {results_path}")
    n_pass = sum(1 for r in results if r["verdict"] == "PASS")
    print(f"score: {n_pass}/{len(results)}")
    if any(r["verdict"] not in ("PASS",) for r in results):
        pass  # report-only; exit 0 so background run isn't flagged red on model flakes


if __name__ == "__main__":
    main()
