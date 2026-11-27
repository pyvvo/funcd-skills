---
name: demo-build
description: Records a demo video of a project from its folder of YAML manifests, without asking the user anything. Its engine sets the demo up, plays it with Playwright in VS Code for the web and the project's own pages, renders the WebM, the MP4 and the poster with ffmpeg, and tears it down; the skill checks every frame, fixes what breaks in the recording, and opens the pull request. Use it whenever a demo's manifests are approved, when the user asks to record, re-record or rebuild a demo or its video (after an upgrade, or a change to the code it shows), or when a demo fails to play, even when they don't say "manifest". Planning what a demo shows is the demo-storyboard skill.
license: Apache-2.0
---

# Record a demo from its manifests

A demo is a folder of YAML manifests, which this skill's engine, `scripts/demo.ts`, plays in VS Code for the web and
the project's sites while Playwright records it. The user approved what it shows with the `demo-storyboard` skill:
record it without asking the user anything. Fix what breaks in the recording, never what the story says. Stop only on
a failure you cannot fix, and report it with its evidence. The manifests' format, the engine's commands and what it
does are in [references/manifests.md](references/manifests.md).

Run the engine from the project's root: `node <this skill's folder>/scripts/demo.ts <command> <folder> ...`.

## 1. Before recording

- **The engine's tools:** Node.js 22.18 or later, `yq`, `ffmpeg`, VS Code's `code`, and Playwright in the project's
  dependencies, with its Chromium. Install nothing without asking: name what is missing.
- **The Environment's needs**, as its setup names them: a container runtime, a service, a tool of the project.
- **The ports:** the editor's and each site's must be free, or the engine refuses. Never stop what listens on a port:
  it is someone else's, so report it. Run `demo.ts down` only for a demo that you brought up.
- **The manifests:** `demo.ts check <folder>` exits 0. A mistake in the mechanics, as a name, a path, a missing key or
  a part's line, is yours to fix. A card that overflows the screen (`demo.ts cards`), or a caption to rewrite, is the
  story: send it back to `demo-storyboard`.

## 2. Record, and fix what breaks

`demo.ts record <folder> <out>` sets the demo up, plays it, renders the video into `<out>`, and tears it down, whatever
happens. Record into a scratch folder first, never into the demo's folder, until the checks pass.

When a step fails, the error names its file, its chapter, its step and its action, and `<out>/failed.png` holds the
page at that moment. Fix the cause, then record again:

- **the step**, in the manifests: a `wait` on what the next step needs, a `shows` on the text that a page shows, a
  longer `timeout`;
- **the setup**, the Environment's or the Demo's, when the workspace lacks what a step needs;
- **the engine**, when the editor or a page behaves another way than it expects: report it with `failed.png` and the
  step, unless the user works on the engine itself.

To try a fix fast: `demo.ts up <folder>`, then `demo.ts play <folder> <out> <n>`, which plays the opening and the first
`n` chapters, then `demo.ts down <folder>`. A second `play` on the same `up` finds what the first one left, such as a
service's data: bring the demo down and up again before trusting it.

## 3. Check every frame

Look at the video before shipping it. Tile it with ffmpeg (`-vf "fps=1/10,scale=400:-1,tile=5x6"`), then each chapter
densely (`fps=1/2.5`), and open any frame in doubt at full size. Each of these slipped into a recording once:

- a caption over the start of the code, the terminal's output or a card;
- a temporary path in a tooltip, the editor or a terminal: it names the machine;
- a command typed into the wrong place: the editor instead of the terminal, or a running process;
- a first character missing from a command;
- a white frame between pages, or the empty editor between two cards;
- a chart cut off or still animating, or a text that wraps on a card;
- an error that the journey caused, as a half-typed file that a watcher ran.

When re-recording a demo, compare its sheets with the committed video's: the same chapters in the same order, each
within a few seconds of the old one, unless the manifests changed.

## 4. Ship it

- **The video is never committed.** Copy the checked render into the demo's folder: `<name>.webm`, `<name>.mp4`, its
  poster `<name>.png`, and `parts/`, for later fixes. The project's `.gitignore` keeps them out of git
  (`docs/demo/*/*.mp4`, `*.webm`, `*.png` and `docs/demo/*/parts/`): add those lines when it lacks them. The teardown
  removes the raw recording, so the files that you checked are the ones to keep.
- Send the video to the user directly.
- Run the project's own checks, as its format and lint, on what changed, then open a pull request with the manifests,
  the Environment's scripts and any tool pins. Its description gives the run, the video's length and what the frame
  checks found. Merge it only on the user's word, as the project's rules say.

## A change to a recorded demo

Record again only the parts that changed: the opening, a chapter, or the recap.

- Copy the demo's `parts/`, the last run's, which stay out of git, into a scratch folder; a checkout without them
  records the whole demo once. Then run `demo.ts record <folder> <scratch> --chapters <names>`. It
  plays the chapters before the first part named as written, as they leave what it starts from, records the parts
  named, keeps the others, and merges them all. Name too a chapter that starts from what a changed one leaves, as a
  file typed or a command run. `merge` refuses a part whose chapter changed since it was recorded, and names it.
- Check the new parts' frames, and each of their seams: the last second of the part before, and the first of the part
  after. The video's length, which `merge` prints, is the sum of its parts'.
- Keep the new parts with the video in the demo's ignored folder, and send the video to the user.
