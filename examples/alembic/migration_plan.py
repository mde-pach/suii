#!/usr/bin/env python3
"""List pending Alembic migrations and the code commit to deploy for each one.

For every pending revision N, the "deploy commit" is the last commit on the
first-parent history of the current branch *before* revision N+1 was added,
i.e. a code state where N is the newest migration. For the last pending
revision it is HEAD.

Usage:
  python migration_plan.py plan               # markdown report (pipe to $GITHUB_STEP_SUMMARY)
  python migration_plan.py plan --json        # JSON for suii: {"current": ..., "plan": [...]}
  python migration_plan.py resolve <revision> # validates <revision>, prints the commit SHA,
                                              # and writes `sha=` to $GITHUB_OUTPUT

Env:
  DATABASE_URL  sync SQLAlchemy URL of the target DB (e.g. postgresql+psycopg://...)
  ALEMBIC_INI   path to alembic.ini (default: alembic.ini)

Requires full git history (actions/checkout with fetch-depth: 0).
"""
import json
import os
import subprocess
import sys

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

ALEMBIC_INI = os.environ.get("ALEMBIC_INI", "alembic.ini")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def commit_adding(path: str) -> str | None:
    """First commit on the first-parent history that added `path`."""
    out = git("log", "--first-parent", "--diff-filter=A", "--format=%H", "--", path)
    return out.splitlines()[-1] if out else None


def pending_revisions():
    script = ScriptDirectory.from_config(Config(ALEMBIC_INI))
    heads = script.get_heads()
    if len(heads) != 1:
        sys.exit(f"Expected a single Alembic head, found {heads}. Run `alembic merge` first.")

    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_heads()

    lower = current[0] if current else "base"
    revs = [
        r for r in script.iterate_revisions(heads[0], lower)
        if r.revision not in current
    ]
    revs.reverse()  # oldest first
    return current, revs


def build_plan():
    current, revs = pending_revisions()
    root = git("rev-parse", "--show-toplevel")
    head_sha = git("rev-parse", "HEAD")
    added = [commit_adding(os.path.relpath(r.path, root)) for r in revs]

    plan = []
    for i, rev in enumerate(revs):
        next_added = added[i + 1] if i + 1 < len(revs) else None
        if next_added is None:
            deploy_sha, deployable = head_sha, True
        else:
            # If N and N+1 arrived in the same commit, no code state stops at N.
            deployable = next_added != added[i]
            deploy_sha = git("rev-parse", f"{next_added}^") if deployable else None
        plan.append({
            "revision": rev.revision,
            "message": (rev.doc or "").strip().splitlines()[0] if rev.doc else "",
            "added_in": added[i],
            "deploy_sha": deploy_sha,
            "deployable": deployable,
        })
    return current, plan


def cmd_plan():
    current, plan = build_plan()
    cur = ", ".join(current) or "base (empty DB)"
    print(f"### Alembic migration plan\n\nDatabase is at **`{cur}`**.\n")
    if not plan:
        print("No pending migrations. The database is at head.")
        return
    print("| # | Revision | Description | Code commit to deploy | Deployable |")
    print("|---|---|---|---|---|")
    for i, p in enumerate(plan, 1):
        sha = f"`{p['deploy_sha'][:8]}`" if p["deploy_sha"] else "n/a"
        ok = "yes" if p["deployable"] else "no (added with next migration)"
        print(f"| {i} | `{p['revision']}` | {p['message']} | {sha} | {ok} |")
    print("\nTo deploy up to a revision, run the **Deploy to migration** workflow, or:\n")
    print("```bash")
    for p in plan:
        if p["deployable"]:
            print(f"gh workflow run deploy.yml -f target_revision={p['revision']}")
    print("```")


def cmd_plan_json():
    current, plan = build_plan()
    print(json.dumps({"current": ", ".join(current) or "base", "plan": plan}, indent=2))


def cmd_resolve(target: str):
    _, plan = build_plan()
    match = next((p for p in plan if p["revision"] == target), None)
    if match is None:
        pending = ", ".join(p["revision"] for p in plan) or "none"
        sys.exit(f"'{target}' is not a pending revision. Pending: {pending}")
    if not match["deployable"]:
        sys.exit(f"'{target}' was added in the same commit as the next migration; "
                 "there is no code state that stops at it.")
    print(match["deploy_sha"])
    if out := os.environ.get("GITHUB_OUTPUT"):
        with open(out, "a") as f:
            f.write(f"sha={match['deploy_sha']}\n")


if __name__ == "__main__":
    if sys.argv[1:] == ["plan", "--json"]:
        cmd_plan_json()
    elif len(sys.argv) >= 2 and sys.argv[1] == "plan":
        cmd_plan()
    elif len(sys.argv) == 3 and sys.argv[1] == "resolve":
        cmd_resolve(sys.argv[2])
    else:
        sys.exit(__doc__)
