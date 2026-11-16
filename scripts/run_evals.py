#!/usr/bin/env python3
"""Run the evals of evals/evals.json with and without the skill, then grade each run against its expected behavior.

Each run is Claude Code in headless mode, in a new empty folder outside this repository, with no user settings, memory or MCP
servers, so that only the skill (or nothing) tells it about funcd. A second headless call grades the run's answer and
files against the eval's expected_behavior list. Every call is paid: a run is capped by --budget dollars.

    python3 scripts/run_evals.py --funcdctl <path to the dev build>          # every eval, both modes
    python3 scripts/run_evals.py --funcdctl <path> --only kv-counter --mode with --model claude-haiku-5-5

The summary is written to .evals/results.json and printed as one line per run.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".evals"
# Each run works outside this repository: inside it, the agent would read AGENTS.md and skills/ even without the skill.
WORK = Path(tempfile.gettempdir()) / "funcd-skill-evals"
ISOLATION = ["--setting-sources", "project,local", "--strict-mcp-config", "--permission-mode", "auto"]
# A run that builds and runs a Function takes several minutes; past this, it is stopped and graded as it stands.
RUN_TIMEOUT_S = 20 * 60
GRADE_PROMPT = """You grade one run of an AI agent against a rubric. Read the agent's final answer below and the files in
the current folder (the agent's working folder). For each rubric item, decide pass or fail from what you can see, and
give one sentence of evidence. Judge a claim about funcd against funcd's docs, never from memory: the live pages
listed at https://pyvvo.github.io/funcd/llms.txt (each link is a page's Markdown copy), or their copies in {refs}.
A claim that a page states passes. Answer with JSON only: {{"items": [{{"item": "...", "pass": true, "evidence": "..."}}]}}

Rubric:
{rubric}

The agent's final answer:
{answer}
"""


def claude(args: list[str], cwd: Path, env: dict[str, str], timeout: int) -> dict:
    cmd = ["claude", "-p", *args, "--output-format", "json"]
    try:
        res = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"result": "", "error": f"stopped after {timeout} s"}
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError:
        return {"result": "", "error": (res.stderr or res.stdout)[-2000:]}


def run_one(ev: dict, mode: str, args: argparse.Namespace, env: dict[str, str]) -> dict:
    work = WORK / f"{ev['id']}-{mode}-{args.model}"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    for f in ev.get("files", []):
        shutil.copy(ROOT / "evals" / f, work)
    extra = ["--plugin-dir", str(ROOT)] if mode == "with" else []
    started = time.monotonic()
    run = claude([ev["query"], "--model", args.model, "--max-budget-usd", str(args.budget), *ISOLATION, *extra],
                 work, env, RUN_TIMEOUT_S)
    seconds = round(time.monotonic() - started)
    (OUT / f"{work.name}.run.json").write_text(json.dumps(run, indent=1))
    rubric = "\n".join(f"- {item}" for item in ev["expected_behavior"])
    refs = ROOT / "skills" / "funcd" / "references"
    prompt = GRADE_PROMPT.format(rubric=rubric, answer=run.get("result", ""), refs=refs)
    grade = claude([prompt, "--model", args.grader, "--max-budget-usd", "0.5", "--add-dir", str(refs), *ISOLATION],
                   work, env, 600)
    try:
        items = json.loads(grade.get("result", "").strip().removeprefix("```json").removesuffix("```"))["items"]
    except (json.JSONDecodeError, KeyError, TypeError):
        items = [{"item": "grading", "pass": False, "evidence": grade.get("error", "unreadable grade")}]
    return {
        "id": ev["id"], "mode": mode, "model": args.model, "seconds": seconds,
        "cost_usd": run.get("total_cost_usd"), "passed": sum(1 for i in items if i.get("pass")),
        "total": len(ev["expected_behavior"]), "items": items, "error": run.get("error"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--funcdctl", type=Path, required=True, help="the dev build of funcdctl the agent may run")
    ap.add_argument("--model", default="claude-sonnet-5-5")
    ap.add_argument("--grader", default="claude-sonnet-5-5")
    ap.add_argument("--mode", choices=["with", "without", "both"], default="both")
    ap.add_argument("--only", help="the id of one eval")
    ap.add_argument("--budget", type=float, default=3.0, help="dollars at most per run (the grade adds up to 0.5)")
    args = ap.parse_args()
    if shutil.which("claude") is None:
        sys.exit("run_evals: claude (Claude Code) is not on the PATH")
    if not os.access(args.funcdctl, os.X_OK):
        sys.exit(f"run_evals: {args.funcdctl} is not an executable funcdctl")
    OUT.mkdir(exist_ok=True)
    bindir = WORK / "bin"
    bindir.mkdir(parents=True, exist_ok=True)
    link = bindir / "funcdctl"
    link.unlink(missing_ok=True)
    link.symlink_to(args.funcdctl.resolve())
    env = {**os.environ, "PATH": f"{bindir}{os.pathsep}{os.environ['PATH']}"}

    evals = [e for e in json.loads((ROOT / "evals" / "evals.json").read_text()) if args.only in (None, e["id"])]
    if not evals:
        sys.exit(f"run_evals: no eval {args.only!r}")
    modes = ["without", "with"] if args.mode == "both" else [args.mode]
    results = []
    for ev in evals:
        for mode in modes:
            r = run_one(ev, mode, args, env)
            results.append(r)
            print(f"{r['id']:<14} {mode:<8} {r['passed']}/{r['total']}  {r['seconds']} s  ${r['cost_usd']}"
                  + (f"  ({r['error']})" if r["error"] else ""))
    (OUT / "results.json").write_text(json.dumps(results, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
