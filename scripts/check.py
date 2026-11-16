#!/usr/bin/env python3
"""Check every skill under skills/ against the Agent Skills specification and the authoring best practices.

    python3 scripts/check.py

Checks (https://agentskills.io/specification, and Anthropic's skill authoring best practices):
- name: 1-64 characters of a-z, 0-9 and single hyphens, equal to the folder name, without "anthropic" or "claude";
- description: 1-1024 characters, no XML tags;
- the body: under 500 lines and about 5000 tokens;
- each relative link of SKILL.md names a file that exists, inside the skill;
- reference files link no other reference file (references stay one level deep);
- a reference file over 100 lines starts with a Contents section.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
XML = re.compile(r"<[A-Za-z/][^>]*>")
REL_LINK = re.compile(r"\]\((?!https?://|#|mailto:)([^)\s#]+)(#[^)]*)?\)")
MAX_BODY_LINES = 500
# About four characters per token for English prose and Markdown.
MAX_BODY_TOKENS = 5000
CHARS_PER_TOKEN = 4
TOC_MIN_LINES = 100


def frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}, text
    fields = {}
    for line in text[4:end].splitlines():
        m = re.match(r"^([a-z-]+):\s*(.*)$", line)
        if m:
            fields[m.group(1)] = m.group(2).strip().strip('"')
    return fields, text[end + 5 :]


def check_skill(folder: Path) -> list[str]:
    errs = []
    skill = folder / "SKILL.md"
    fields, body = frontmatter(skill.read_text())
    name, desc = fields.get("name", ""), fields.get("description", "")
    if not NAME.match(name) or len(name) > 64:
        errs.append(f"name {name!r}: want 1-64 characters of a-z, 0-9 and single hyphens")
    if name != folder.name:
        errs.append(f"name {name!r} differs from its folder {folder.name!r}")
    if "anthropic" in name or "claude" in name:
        errs.append(f"name {name!r} holds a reserved word")
    if not 1 <= len(desc) <= 1024:
        errs.append(f"description: {len(desc)} characters, want 1-1024")
    if XML.search(desc):
        errs.append("description holds an XML tag")
    lines = body.count("\n")
    if lines >= MAX_BODY_LINES:
        errs.append(f"body: {lines} lines, want under {MAX_BODY_LINES}")
    tokens = len(body) // CHARS_PER_TOKEN
    if tokens > MAX_BODY_TOKENS:
        errs.append(f"body: about {tokens} tokens, want at most {MAX_BODY_TOKENS}")
    for m in REL_LINK.finditer(body):
        target = (folder / m.group(1)).resolve()
        if not target.is_file() or folder.resolve() not in target.parents:
            errs.append(f"link {m.group(1)}: no such file in the skill")
    for ref in sorted((folder / "references").glob("*.md")):
        text = ref.read_text()
        for m in REL_LINK.finditer(text):
            errs.append(f"{ref.name}: links {m.group(1)}; references must not link other files")
        if text.count("\n") > TOC_MIN_LINES and "\n## Contents\n" not in text:
            errs.append(f"{ref.name}: over {TOC_MIN_LINES} lines without a Contents section")
    print(f"{folder.name}: {lines} body lines, about {tokens} tokens, {len(desc)}-character description")
    return [f"{folder.name}: {e}" for e in errs]


def main() -> int:
    folders = sorted(p.parent for p in (ROOT / "skills").glob("*/SKILL.md"))
    if not folders:
        print("check: no skills/*/SKILL.md")
        return 1
    errs = [e for f in folders for e in check_skill(f)]
    for e in errs:
        print(f"FAIL {e}")
    print("PASS" if not errs else f"{len(errs)} problem(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
