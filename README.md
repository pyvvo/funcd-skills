# funcd skills

Agent skills for building on [funcd](https://funcd.dev/), the single-binary serverless platform, in two plugins.
The `funcd` skill tells a coding agent to read funcd's docs before it writes, to run the work locally with
`funcdctl dev`, and to check each manifest with `funcdctl apply --dry-run` until it passes. The `demo` plugin plans a
demo video of a project's feature with the user, then records it from a folder of YAML manifests. They follow the
[Agent Skills](https://agentskills.io/specification) format.

```
funcd-skills/
├── .claude-plugin/
│   ├── marketplace.json
│   └── plugin.json
├── AGENTS.md
├── evals/
│   └── evals.json
├── plugins/
│   └── demo/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       └── skills/
│           ├── demo-build/
│           │   ├── SKILL.md
│           │   ├── references/
│           │   │   └── manifests.md
│           │   └── scripts/
│           └── demo-storyboard/
│               └── SKILL.md
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
claude plugin install demo@funcd-skills
```

Any agent that reads the Agent Skills format (Codex, Cursor, Gemini CLI, OpenCode and others):

```sh
npx skills add pyvvo/funcd-skills --skill funcd
npx skills add pyvvo/funcd-skills --skill demo-storyboard --skill demo-build
```

Or copy `skills/funcd/` into the agent's skills folder, such as `.agents/skills/` of a project for Codex or
`~/.claude/skills/` for Claude Code.

Claude on claude.ai or the Claude app, for the `funcd` skill: download `funcd.zip` from the
[latest release](https://github.com/pyvvo/funcd-skills/releases/latest), then upload it under Settings, Capabilities,
Skills.

An agent that reads only `AGENTS.md`: copy [AGENTS.md](AGENTS.md) into the project, or add its sections to the
project's own `AGENTS.md` or `CLAUDE.md`.

The `funcd` skill runs `funcdctl`, in its dev build, and Node.js, or Python 3.12 or later (`python3` or
`FUNCD_PYTHON`). The [Install](https://funcd.dev/docs/get-started/install) page installs funcdctl.

## The demo plugin

A demo is a folder of YAML manifests: the Environment where it plays, the Files of the project that it opens or
types, its cards, and its chapters with their steps. The `demo-storyboard` skill plans a demo with the user and writes
its manifests; the `demo-build` skill records it without asking. A demo replays code that exists, so the feature
comes first.

The engine, `scripts/demo.ts` in the `demo-build` skill, plays a demo in VS Code for the web and the project's own
pages while Playwright records it, then renders the video with ffmpeg. A person runs it too, from the project's root:

```sh
node <demo-build>/scripts/demo.ts check docs/demo/<demo>
node <demo-build>/scripts/demo.ts record docs/demo/<demo> docs/demo/<demo>
```

[`references/manifests.md`](plugins/demo/skills/demo-build/references/manifests.md) describes the manifests and the
commands. The engine needs Node.js 22.18 or later, yq, ffmpeg, VS Code's `code` command, and Playwright in the
project's dependencies, with its Chromium. It runs on the local machine, so the demo skills are not for claude.ai.

## Keep it current

The docs describe funcd's latest release, and the `funcd` skill names the release it was made from in
`metadata.docs-release`. The `refresh` workflow regenerates the index, the references and `AGENTS.md` from the docs
site every day, and opens a pull request when they changed. To regenerate by hand:

```sh
python3 scripts/generate.py
python3 scripts/check.py
```

`generate.py --build <dir>` reads a local build of the docs site instead, and `--check` only reports what would change.
`check.py` checks each skill against the Agent Skills specification: the name and description, a body under 500 lines
and about 5000 tokens, links that resolve, and references one level deep.

## Evals

`evals/evals.json` holds the tasks the `funcd` skill must get right, each with the behavior that a grader checks.
`scripts/run_evals.py` runs each one in Claude Code headless mode, in an empty folder with no user settings, with and
without the skill, then grades each answer:

```sh
python3 scripts/run_evals.py --funcdctl "$(command -v funcdctl)" --model claude-haiku-5-5
```

Every run is paid, and `--budget` caps each one. Run the evals on each model the skill must serve, and add an eval
for each task an agent got wrong.

## License

Apache-2.0. Copyright The funcd Authors.
