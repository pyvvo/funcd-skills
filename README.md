# funcd skills

Agent skills for building on [funcd](https://pyvvo.github.io/funcd/), the single-binary serverless platform. The
`funcd` skill tells a coding agent to read funcd's docs before it writes, to run the work locally with
`funcdctl dev`, and to check each manifest with `funcdctl apply --dry-run` until it passes. It follows the
[Agent Skills](https://agentskills.io/specification) format.

```
funcd-skills/
├── .claude-plugin/
│   ├── marketplace.json
│   └── plugin.json
├── AGENTS.md
├── evals/
│   └── evals.json
├── scripts/
│   ├── agents-template.md
│   ├── check.py
│   ├── generate.py
│   └── run_evals.py
└── skills/
    └── funcd/
        ├── SKILL.md
        └── references/
```

`SKILL.md` holds the workflow and an index of the docs, in which every page links its Markdown copy. `references/`
holds the Usage pages and funcdctl's command reference, for an agent with no network. `AGENTS.md` holds the same rules and index, for an agent that
reads only `AGENTS.md`.

## Install

Claude Code:

```sh
claude plugin marketplace add pyvvo/funcd-skills
claude plugin install funcd@funcd-skills
```

Any agent that reads the Agent Skills format (Codex, Cursor, Gemini CLI, OpenCode and others):

```sh
npx skills add pyvvo/funcd-skills
```

Or copy `skills/funcd/` into the agent's skills folder, such as `.agents/skills/` of a project for Codex or
`~/.claude/skills/` for Claude Code.

Claude on claude.ai or the Claude app: download `funcd.zip` from the
[latest release](https://github.com/pyvvo/funcd-skills/releases/latest), then upload it under Settings, Capabilities,
Skills.

An agent that reads only `AGENTS.md`: copy [AGENTS.md](AGENTS.md) into the project, or add its sections to the
project's own `AGENTS.md` or `CLAUDE.md`.

The skill runs `funcdctl`, in its dev build, and Node.js, or Python 3.12 or later (`python3` or `FUNCD_PYTHON`). The
[Install](https://pyvvo.github.io/funcd/docs/get-started/install) page installs funcdctl.

## Keep it current

The docs describe funcd's latest release, and the skill names the release it was made from in
`metadata.docs-release`. The `refresh` workflow regenerates the index, the references and `AGENTS.md` from the docs
site every day, and opens a pull request when they changed. To regenerate by hand:

```sh
python3 scripts/generate.py
python3 scripts/check.py
```

`generate.py --build <dir>` reads a local build of the docs site instead, and `--check` only reports what would change.
`check.py` checks the skill against the Agent Skills specification: the name and description, a body under 500 lines
and about 5000 tokens, links that resolve, and references one level deep.

## Evals

`evals/evals.json` holds the tasks the skill must get right, each with the behavior that a grader checks.
`scripts/run_evals.py` runs each one in Claude Code headless mode, in an empty folder with no user settings, with and
without the skill, then grades each answer:

```sh
python3 scripts/run_evals.py --funcdctl "$(command -v funcdctl)" --model claude-haiku-5-5
```

Every run is paid, and `--budget` caps each one. Run the evals on each model the skill must serve, and add an eval
for each task an agent got wrong.

## License

Apache-2.0. Copyright The funcd Authors.
