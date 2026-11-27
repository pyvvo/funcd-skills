---
name: demo-storyboard
description: Plans a demo video of a project's feature with the user, then writes it as a folder of YAML manifests that the demo-build skill records. It reads the feature's code, asks what to highlight and which files to type, writes the manifests (Files that point at the code, cards, chapters and their steps), and reviews them and their cards with the user until they approve. Use it whenever the user wants a demo, a video, a walkthrough or a screencast of what a project does, or wants to change what a demo shows (its story, chapters, captions or cards), even when they don't say "manifest" or "storyboard". A demo replays code that exists, so the feature comes first. Recording an approved demo is the demo-build skill.
license: Apache-2.0
---

# Plan a demo: its manifests

A demo is a folder of YAML manifests: everything that the video shows, as data, which the `demo-build` skill records
without asking anyone. This skill is the only place where the user is asked: what they approve here is what the video
shows.

A demo replays code that exists. Its Files point at the project's own files, and its chapters open or type them, then
show their result. When the feature is not built yet, say so and stop: the demo comes after the code.

The format is in the `demo-build` skill's `references/manifests.md`, and its engine is that skill's `scripts/demo.ts`,
in the folder beside this one: read the format before writing.

## 1. Read before asking

Propose defaults from the project, and ask only what it cannot answer:

- **the feature:** its code, its docs and specs, and its tests: what a developer writes for it, which the demo shows
  or types, and what a tool writes for them, which a card of the generated files shows;
- **where each layer shows its result:** a page of the project, a terminal's output, a file;
- **the demos that exist,** YAML files of `kind: Demo`, and their Environment, which a new demo includes;
- **how the project runs:** its dev commands and their ports, which an Environment's setup and sites use.

## 2. Ask, in one round

Ask with the question tool when there is one, each question with a recommended answer from step 1:

1. **The goal and the scenario.** Which feature, shown to whom (developers, product people), and the one sentence that
   the viewer should keep.
2. **What to highlight.** A table of contents of 3 to 6 chapters, one per layer of the feature, proposed from step 1.
3. **Which files to type.** The one or two files that the developer writes for this feature, so that the viewer sees
   that they are code; open the others, scrolled or formatted when that shows them better.
4. **Its length.** 3 to 5 minutes; a chapter takes 30 to 50 seconds.
5. **Where it goes:** a new folder, as `docs/demo/<demo>/`, or in place of an existing demo.
6. **The Environment,** when the project has none: the workspace, a scratch copy of the current commit, what starts the
   sites, and their ports.

## 3. Write the manifests

- **The story's order:** a `text` card with the goal and the scenario; a `list` card of why, 4 or 5 points of what the
  feature saves; a `list` card of the tools, each with what it does; a `contents` card; a `tree` card of the files
  that the developer writes, drawn from their Files; then the chapters; a `tree` card of what a command generates,
  where one does; a recap card.
- **Files first:** one for each file that a step opens, types or uploads, with its path in the project and a comment of
  a few words, which a tree card shows. A file typed in two chapters gets `parts`, split at its own lines.
- **A chapter** shows its file in the editor first, then the same layer where it shows its result: a site or the
  terminal. One idea per caption. On a page, `fill`, `press` and `click` act as a person would: read the page's code
  for the names that its fields and buttons show.
- **Captions:** one short sentence, 80 characters at most, so that it fits the corner in two lines; `detail` names the
  file or the command. Hold a caption 4 to 7 seconds when the viewer reads it, 2 to 3 between actions.
- **Waits:** a `wait` on what the project does (an answer, a file, a text), never a long `hold`; a slow command, as a
  build, gets `speed: 16`.
- **Names in commands:** a command types the names that the demo knows in advance: the manifests' own (an App, a
  Function, a Job), a run that the demo starts and names itself, a revision that follows from its generation. Look up
  a generated name, as `$(… | jq …)`, only when there is no other way, as for a run that the platform names itself
  with no command that takes its owner's name; then the caption says what the lookup finds.
- **Steps:** a sequence that chapters repeat, as a wait and then a page, becomes a Steps with params.
- **The Environment:** its workspace is a copy that its setup makes, as a git worktree of the current commit, never the
  project itself, and its teardown removes only what its own run made. Its scripts are the project's code: write them
  in the shape of the project's own scripts, and list them for the user in step 4.
- **Check it:** `demo.ts check <folder>`, then `demo.ts cards <folder> <out>`: both must exit 0. Each names the
  mistakes, and `cards` each card that overflows the screen: shorten that card's text.

## 4. Review it with the user

Send `cards.png`, the sheet of every card, and the demo told as the viewer sees it: for each chapter, what shows and
what each caption says. Fix what the user points at and send it again, until they approve it.

The approved manifests are all that the recording needs: then use the `demo-build` skill, which records them, checks
the video and opens the pull request. Record nothing here.
