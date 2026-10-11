#!/usr/bin/env python3
"""Phase C live compaction: does the symcomp hook fire in a real server?
Uses the background service API with location-scoped scratch configs
(.test-work/compact/<name>/opencode.jsonc -> absolute plugin path).
Flow per variant: create session -> short prompt -> wait for reply ->
POST compact -> read messages -> check summary marker.
Results: .logs/compact-results.json (workdir-local).
Usage: python3 test-compact.py [--only <name>]
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORK = ROOT / ".test-work" / "compact"
LOGS = ROOT / ".logs"
MODEL = {"providerID": "opencode", "id": "muse-spark-1.3-contributor-free"}

VARIANTS = {
    # name: (plugin_dir or None, expect_marker: bool)
    "stock": (None, False),
    "oc-symcomp": ("plugins/oc-symcomp", True),
    "oc-symbolic-epistemic-symcomp": ("plugins/oc-symbolic-epistemic-symcomp", True),
}
MARKER = "SYMBOLIC AUTO-COMPACT"


def api(method, path, data=None):
    cmd = ["opencode", "api", method, path]
    if data is not None:
        cmd += ["--data", json.dumps(data)]
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"api {method} {path} failed: {proc.stderr[-500:]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"_raw": proc.stdout}


def write_config(name, plugin_rel):
    d = WORK / name
    d.mkdir(parents=True, exist_ok=True)
    cfg: dict = {"$schema": "https://opencode.ai/config.json"}
    if plugin_rel is not None:
        cfg["plugins"] = [str(ROOT / plugin_rel)]
        cfg["compaction"] = {"auto": True, "keep": {"tokens": 15000}, "buffer": 20000}
    (d / "opencode.jsonc").write_text(json.dumps(cfg, indent=2))
    return str(d)


def wait_for(pred, timeout_s, what):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if pred():
            return True
        time.sleep(3)
    raise TimeoutError(f"timeout waiting for {what}")


def messages(ses):
    return api("get", f"/api/session/{ses}/message")


def flat_text(msgs):
    out = []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ("text", "summary", "thinking") and isinstance(v, str):
                    out.append(v)
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(msgs)
    return "\n".join(out)


def run_variant(name):
    plugin_rel, expect_marker = VARIANTS[name]
    directory = write_config(name, plugin_rel)
    ses = api("post", "/api/session", {"title": f"oc-compact-{name}", "location": {"directory": directory}, "model": MODEL})
    inner = ses.get("data", ses) if isinstance(ses, dict) else {}
    ses_id = inner.get("id") or inner.get("sessionID")
    assert ses_id, f"no session id in {str(ses)[:300]}"
    api("post", f"/api/session/{ses_id}/prompt", {"text": "Reply with exactly: HIST-OK"})
    wait_for(lambda: "HIST-OK" in flat_text(messages(ses_id)), 300, "HIST-OK reply")
    api("post", f"/api/session/{ses_id}/compact", {})
    wait_for(lambda: MARKER in flat_text(messages(ses_id)) or "summary" in flat_text(messages(ses_id)).lower(), 300, "compaction")
    time.sleep(5)
    all_text = flat_text(messages(ses_id))
    has_marker = MARKER in all_text
    verdict = "PASS" if has_marker == expect_marker else "FAIL"
    return {"name": name, "verdict": verdict, "sessionID": ses_id, "has_marker": has_marker,
            "expect_marker": expect_marker, "tail": all_text[-800:]}


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    names = [only] if only else list(VARIANTS)
    results = []
    for n in names:
        print(f"[compact] running {n} ...", flush=True)
        try:
            res = run_variant(n)
        except Exception as e:  # noqa
            res = {"name": n, "verdict": "ERROR", "error": str(e)[:500]}
        results.append(res)
        print(f"[compact] {n}: {res['verdict']} marker={res.get('has_marker')}", flush=True)
    p = LOGS / "compact-results.json"
    prev = json.loads(p.read_text()) if p.exists() else []
    prev = [r for r in prev if r["name"] not in names] + results if only else results
    p.write_text(json.dumps(results if not only else prev, indent=2))
    print(f"wrote {p}")
    if any(r["verdict"] != "PASS" for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
