# Demo manifests

A demo is a folder of YAML manifests, which the engine, `scripts/demo.ts` in the demo-build skill, plays in VS Code for
the web and the project's sites while Playwright records one page. Each manifest has a `kind` and a `name`. A demo
replays code that exists: its Files point at the project's own files, which its chapters open or type, then show at
work.

## Contents

- The folder
- Paths, names and YAML
- Demo
- Environment
- File
- Card
- Chapter
- Steps
- The steps' actions
- The commands
- Parts
- What the engine does

## The folder

```text
docs/demo/
├── environment.yaml        # an Environment that the project's demos include
└── <demo>/
    ├── demo.yaml           # the Demo: its Environment, its cards and chapters in order
    ├── cards.yaml          # the Cards, separated by ---
    ├── files.yaml          # the Files, and the tree card drawn from them
    ├── steps.yaml          # the Steps that its chapters repeat
    ├── 1-<chapter>.yaml    # one Chapter a file
    ├── 2-<chapter>.yaml
    ├── setup.sh            # its own setup, when it has one
    ├── <name>.mp4          # the video, <name>.webm, and <name>.png, its poster: never committed
    └── parts/              # the video's parts, for a later fix: never committed
```

The video, its poster and its parts are built, never committed: the project's `.gitignore` keeps them out of git
(`docs/demo/*/*.mp4`, `*.webm`, `*.png` and `docs/demo/*/parts/`), and the video goes to its viewers directly.

The engine reads every `*.yaml` file directly in the demo's folder, and the files and folders that the Demo's
`include` lists. A file holds one manifest or more, separated by `---`. Exactly one manifest is a Demo. Other files go
in subfolders, which the engine does not read: a sample, or the files that the demo's setup adds to the workspace.

## Paths, names and YAML

- **Paths** start at the project's root, the git checkout that holds the demo's folder. The workspace is a copy of the
  project, so a path names the same file in both.
- **Names** are lowercase words joined by hyphens, and unique in each kind. A step names a File, a Card or a Steps by
  its name, never by a path.
- **YAML** is written in block style. Quote a text that holds `: `, or starts with `` ` ``, `*`, `{` or `$`.
- **Variables:** `${NAME}` in an Environment's `workspace` and `editor.env` is a variable of the engine's environment;
  `TMPDIR` defaults to the system's temp folder, and `editor.env` also takes `DEMO_WORKSPACE`, `DEMO_PROJECT` and
  `DEMO_FOLDER`.

## Demo

| Key           | What it holds                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `name`        | The demo's name, and its video's: `<name>.mp4`, `<name>.webm` and `<name>.png`.                                  |
| `title`       | What it shows, in a few words.                                                                                   |
| `environment` | The name of the Environment where it plays.                                                                      |
| `include`     | Files or folders of more manifests: an Environment, or Steps that several demos share.                           |
| `setup`       | Its own command, after the Environment's `setup` and before its `start`: what the workspace needs for this demo. |
| `teardown`    | Its own command, before the Environment's `teardown`.                                                            |
| `terminal`    | `cwd`, the folder where the journey types its commands, and `prompt`, the name that the prompt shows.            |
| `opening`     | The Cards before the first chapter, in order.                                                                    |
| `chapters`    | The Chapters, in order.                                                                                          |
| `recap`       | The card that ends the video. Optional.                                                                          |

`terminal` defaults to the workspace's root, and a prompt of its folder's name.

## Environment

Where a demo plays: the workspace, the services that the sites serve, and the editor.

| Key           | What it holds                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `workspace`   | The folder that `setup` makes, a copy of the project, which the editor opens: an absolute path, never the project. |
| `setup`       | A shell command, run from the project's root, which makes the workspace, as a git worktree of the current commit.  |
| `start`       | A command that starts the sites' services on the workspace, once the Demo's own setup has changed it.              |
| `teardown`    | A command that stops what setup and the journey started, and removes the workspace.                                |
| `sites`       | Names and URLs: a `page` or a `url` that starts with `<name>:` goes to that site, as `app:/orders`.                |
| `editor`      | VS Code for the web: `port`, `commit`, `acceptLicense`, `env` and `settings`, below.                               |
| `viewport`    | The recording's `width` and `height`: 1280 and 720 by default.                                                     |
| `typingDelay` | Milliseconds a typed character: 18 by default.                                                                     |
| `addressBar`  | `true` draws a browser's address bar above a site's page: its URL, with a lock for https. `false` by default.      |

- `editor.port` is the editor's port, 8799 by default. `editor.commit` is the VS Code build that serve-web runs,
  its `--commit-id`, which it downloads once when it is not cached. `editor.acceptLicense: true` accepts the VS Code
  Server license, which serve-web asks for: the engine refuses to start it otherwise.
- `editor.env` holds the terminal's variables, and `editor.settings` VS Code settings over the engine's own, merged key
  by key: the project's folders to hide, as `files.exclude`.
- The commands get `DEMO_PROJECT`, `DEMO_FOLDER`, `DEMO_WORKSPACE`, `DEMO_STATE`, the engine's folder for this demo,
  and `DEMO_SITE_<NAME>`, each site's URL, as `DEMO_SITE_APP`.
- The order: the Environment's `setup`, the Demo's `setup`, the Environment's `start`, the editor, the journey; then
  the editor stops, the Demo's `teardown`, the Environment's `teardown`. Teardown also runs after a failed setup, so it
  removes only what its own run made: setup writes `DEMO_STATE` in the workspace's folder, and teardown checks it.
- Before setup, the editor's port and each local site's port must be free.

## File

A file of the project that a step opens, types or uploads, or that a tree card shows.

| Key       | What it holds                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `path`    | Its path from the project's root, which is also its path in the workspace.                                        |
| `source`  | The file whose text `type` types, when it is not the project's own file at `path`.                                |
| `comment` | What the file is, in a few words: the line above it in a tree card.                                               |
| `parts`   | Named parts, for a file typed a part at a time: `from`, its first line, and `until`, the line after its last one. |

- `from` and `until` are whole lines of the file; a part without `from` starts at the first line, without `until` it
  ends with the file.
- `source` serves a demo whose setup adds a feature that the project lacks yet; once the project has it, the File
  drops `source`.
- A `path` whose name holds `*`, as `docs/demo/x/1-*.yaml`, names a file that the journey writes under a name of its
  own: `open`, `upload` and `wait` take the first file of its folder that matches, in their names' order. A typed File
  has its whole name.
- A typed File's text is read from the project. Before the journey, the engine leaves in the workspace only what comes
  before its first typed part: no file, or the lines before it. Each part then starts where the one before it ended.

## Card

| Key               | What it holds                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `layout`          | `text`, `list`, `contents` or `tree`.                                                        |
| `kicker`, `title` | The small line above the title, and the title.                                               |
| `seconds`         | How long it shows: 8 in the opening, 6 for a `card` step and 9 for the recap, by default.    |
| `paragraphs`      | A text card's paragraphs: the goal and the scenario, under a large title.                    |
| `items`, `footer` | A list card's items, and a line under them.                                                  |
| `tree`            | A tree card's folder tree, written, with a comment above a file on a line `│ # …`.           |
| `files`, `root`   | In place of `tree`: Files, drawn as a tree from their paths, each with its comment above it. |
| `compact`         | `true` for a long tree, in smaller type.                                                     |

- A contents card lists the chapters' titles and details, numbered.
- A tree drawn from `files` is a blueprint: the files that the developer writes, which the steps open or type. `root`
  is the folder at its top, by default the one that holds them all. A written `tree` shows what is not a File, such as
  what a command generates.
- A card's text takes two marks, `**bold**` and `` `code` ``. Cards with no step between them fade into each other, as
  the opening's do with the first chapter's.

## Chapter

| Key               | What it holds                             |
| ----------------- | ----------------------------------------- |
| `title`, `detail` | What its card and the contents card show. |
| `cardSeconds`     | How long its card shows: 4 by default.    |
| `steps`           | Its steps, in order.                      |

Its card shows its number. Every Chapter of the folder is in the Demo's `chapters`.

## Steps

A sequence of steps that chapters repeat, with params.

| Key      | What it holds                                                    |
| -------- | ---------------------------------------------------------------- |
| `params` | Its params: each a name, or a `name` and a `default`.            |
| `steps`  | The steps, in which `${param}` takes the value that a use gives. |

A step uses it with `use: <name>`, and `with:`, the params' values. A text that is only `${param}` takes the value as
it is, a number included. Steps may use other Steps.

```yaml
- use: show-page
  with:
    path: /orders
    caption: "The orders page: each row as the import wrote it"
    shows: Ordered on
```

## The steps' actions

A step is one action, named by its first key, and `hold`, the seconds to wait after it; a step of `hold` alone waits.

| Action     | What it does, and its other keys                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `open`     | Opens a File from the Explorer, its folders expanded on the way.                                                         |
| `collapse` | Collapses a folder of the Explorer, by its path.                                                                         |
| `type`     | Types a File, or its `part`: a new file through the Explorer's New File, or text at the end of the file.                 |
| `command`  | Runs a VS Code command by its exact title, as `Format Document`.                                                         |
| `language` | Changes the editor's language mode, as `json` before `command: Format Document` on a JSONL line.                         |
| `run`      | Types a command in the last terminal, and opens the first one.                                                           |
| `terminal` | `split`: a second terminal beside the first, where the next `run` types, while the first keeps a long command.           |
| `panel`    | `hide` or `show` the terminal's panel, to show a whole file.                                                             |
| `scroll`   | Scrolls the editor down by about that many lines.                                                                        |
| `reveal`   | Goes to the open file's first line that starts with that text.                                                           |
| `caption`  | Shows a caption in the bottom left corner, with `detail` under it in smaller type; `''` hides it.                        |
| `page`     | Shows `editor`, a site (`<site>:/path`) or a URL; `caption` and `detail` once it opens, and `shows`, a text to wait for. |
| `scrollTo` | Scrolls a web page until that text is near its top.                                                                      |
| `pick`     | Opens a field by its label and picks its `option`.                                                                       |
| `upload`   | Clicks a button by its name, and gives it a File: `file`.                                                                |
| `click`    | Clicks the element of a page with that name: a button, a link, a tab or a box to tick, else that exact text.             |
| `fill`     | Types `value` into the field of a page with that label or placeholder, in place of its text, as a person would.          |
| `press`    | Presses a key where the keyboard is: `Enter` after a `fill`, `Escape`, or a combination, as `ControlOrMeta+a`.           |
| `wait`     | Waits, its value naming what for, on one of `url`, `file` and `text`, below.                                             |
| `card`     | Shows a Card; its `seconds` say how long, so it takes no `hold`.                                                         |
| `use`      | Plays a Steps, with `with`.                                                                                              |

- `wait` with `url`: the URL answers 200, with `method` and `body`, and `until`, a JavaScript expression of `it`, the
  answer's JSON. With `file`: a File exists in the workspace. With `text`: the page shows that text. `timeout` is 120
  seconds by default, and the wait plays `speed` times faster in the video, 8 by default.
- `shows`, `text` and `scrollTo` match a whole text, exactly.
- `click`, `fill`, `pick` and `upload` name an element as the page names it for a person: a button's text, a
  field's label.
- `type` hides the terminal while it types, then saves once, as a watcher may act on each save. It types the text one
  character at a time, with no auto-indent and no suggestions.
- An action in the editor brings it back first when a site shows; its reload plays fast in the video.
- A caption belongs to the site that shows it: a reload keeps it, and another site does not. A chapter that starts on a
  site and captions the editor starts with `page: editor`.

## The commands

Run the engine from the project's root, or under it: `node <demo-build>/scripts/demo.ts <command> <folder> ...`.

| Command                                  | What it does                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `check <folder>`                         | Reads and checks the manifests, naming every mistake at once, then sums them up.       |
| `cards <folder> <out>`                   | Draws each card as a PNG, and `cards.png`, all of them on one sheet.                   |
| `up <folder>`                            | Runs the setup, then starts the editor: everything that the journey uses.              |
| `play <folder> <out> [<last chapter>]`   | Plays the demo and records it into `<out>`; `<last chapter>` stops after it.           |
| `render <folder> <out>`                  | Renders what `play` recorded in `<out>` into parts, then the video once all are there. |
| `merge <folder> <out>`                   | Joins the parts in `<out>/parts/` into the video, with no encoding.                    |
| `down <folder>`                          | Stops the editor, then runs the teardown.                                              |
| `record <folder> <out> [<last chapter>]` | `up`, `play`, `render` into `<out>`, then `down`, whatever happens.                    |
| `record <folder> <out> --chapters <a,b>` | The same for the parts named only, keeping the others: see Parts.                      |

- `check` and `cards` start nothing. `cards` exits 1 on a card whose text overflows the screen.
- A failed step names its file, its chapter, its step and its action, and leaves `failed.png` in `<out>`.
- A demo that is up has a state folder in the system's temp folder; `up` refuses a second one, and `down` reads what
  it needs from that folder, even when the manifests changed since.
- The engine needs Node.js 22.18 or later, yq, ffmpeg, VS Code's `code` command, and Playwright in the project's
  dependencies, with its Chromium.

## Parts

The video is made of parts, in this order: `opening`, each Chapter by its name, from its card, and `recap`. A chapter's
card is a full-screen transition, so a seam falls where the viewer expects a cut. The render writes each part to
`<out>/parts/`, as `<part>.webm`, `<part>.mp4` and `<part>.json`, all with the same settings, and `merge` joins them
with ffmpeg's concat demuxer, with no encoding. No Chapter is named `opening` or `recap`.

- `record <folder> <out> --chapters in-the-app,recap` records the parts named, keeps the others' files in
  `<out>/parts/`, then merges them all. The chapters before the first part named play as written, to leave the state
  that it starts from: an App deployed, a file typed, a terminal's history. Their video goes, and the journey stops
  after the last part named. A live demo spends its live time on them again.
- A part's `.json` keeps the hash of what it shows: its cards, its steps with the text that they type, the files that
  they open, and the look of the recording. `merge` refuses a part that is missing, or whose hash no longer matches,
  and names it.
- What the chapters before a part leave is not in its hash: a change that alters what a later chapter starts from,
  such as a file typed or a command run, needs that chapter recorded again too. Name it in `--chapters`.
- Keep `<out>/parts/` beside the video for a later fix, out of git as the video is. A checkout without them records
  the whole demo once.

## What the engine does

- **The editor** is `code serve-web` on the workspace, in a process group of its own. VS Code for the web keeps user
  settings in the browser, so the engine writes the workspace's `.vscode/settings.json`: no walkthrough, no AI, no
  suggestions, no autosave, a long hover delay, as a tooltip shows a file's full path, and a terminal whose prompt
  shows the Demo's `prompt` alone.
- **A site's page**, when the Environment's `addressBar` is true, shows its address in a bar above it, as a browser
  would: the video has no browser around the page. The page starts 36 pixels lower, below the bar.
- **The workspace** is the only place that the engine writes: those settings, and each typed File's starting text.
- **The video** is Playwright's recording of one page, which goes from the editor to the sites and back. Cards are
  frames laid over that page, so the editor keeps its state under them. The render cuts the editor's first visit,
  plays each long wait faster, writes each part as WebM (VP9) and MP4 (H.264) with ffmpeg, and `merge` joins them into
  `<name>.webm` and `<name>.mp4`, and takes the poster shortly before the recap.
