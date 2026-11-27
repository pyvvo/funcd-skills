// The demo engine (references/manifests.md). A demo is a folder of manifests: the engine checks them, draws the cards,
// sets the demo up, plays it in VS Code for the web and the project's sites while Playwright records it, renders the
// video with ffmpeg, then tears everything down. It needs Node.js 22.18 or later, yq, ffmpeg, VS Code's `code`, and
// Playwright with its Chromium in the project.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { renderCards } from './cards.ts';
import {
  isPortTaken,
  startEditor,
  stopEditor,
  writeEditorSettings
} from './editor.ts';
import { playJourney } from './journey.ts';
import { type IDemo, actionOf, loadDemo } from './manifests.ts';
import { partNames } from './parts.ts';
import { mergeParts, renderParts } from './render.ts';

const usage = `usage: node demo.ts <command> <folder> [<output folder>] [<last chapter>] [--chapters <names>]

  check <folder>                          check the manifests, naming every mistake
  cards <folder> <out>                    the cards as images, and cards.png with all of them
  up <folder>                             setup, then the editor: all that the journey uses
  play <folder> <out> [<last chapter>]    the journey, recorded in <out>; 0 plays the opening alone
  render <folder> <out>                   the parts that play recorded in <out>, then the video once all are there
  merge <folder> <out>                    join the parts in <out>/parts into the video, with no encoding
  down <folder>                           stop the editor, then teardown
  record <folder> <out> [<last chapter>]  up, play, render the parts into <out> and merge them, then down
  record <folder> <out> --chapters <a,b>  the same for the parts named, keeping the others: opening, a chapter, recap`;

// What `down` needs, saved by `up`, so that it tears down even when the manifests changed or broke since
interface IState {
  root: string;
  env: Record<string, string>;
  // the Demo's teardown, then the Environment's
  teardown: string[];
  editor?: { pid: number; port: number };
}

// The state of a demo that is up: one folder in the system's temp folder for each demo's folder
const stateOf = (folder: string) => {
  const path = resolve(folder);
  const hash = createHash('sha1').update(path).digest('hex').slice(0, 8);
  return join(tmpdir(), `demo-${basename(path)}-${hash}`);
};

const saveState = (state: string, saved: IState) =>
  writeFileSync(
    join(state, 'state.json'),
    `${JSON.stringify(saved, null, 2)}\n`
  );

// Runs a setup or teardown command from the project's root, with the demo's variables
const run = (command: string, root: string, env: Record<string, string>) => {
  const result = spawnSync('bash', ['-c', command], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
  if (result.status !== 0)
    throw new Error(`${command}: exit ${result.status ?? result.signal}`);
};

// The variables that setup and teardown get
const variables = (demo: IDemo, state: string) => {
  const env: Record<string, string> = {
    DEMO_PROJECT: demo.root,
    DEMO_FOLDER: demo.folder,
    DEMO_WORKSPACE: demo.environment.workspace,
    DEMO_STATE: state
  };
  for (const [name, url] of Object.entries(demo.environment.sites))
    env[`DEMO_SITE_${name.toUpperCase().replace(/-/g, '_')}`] = url;
  return env;
};

// The local ports that must be free before setup: the editor's, then each site's on this machine
const localPorts = (demo: IDemo) => {
  const ports = [demo.environment.editor.port];
  for (const url of Object.values(demo.environment.sites)) {
    const { hostname, port, protocol } = new URL(url);
    if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname))
      ports.push(Number(port || (protocol === 'https:' ? 443 : 80)));
  }
  return ports;
};

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const summary = (demo: IDemo) => {
  const steps = demo.chapters.reduce(
    (sum, chapter) => sum + chapter.steps.length,
    0
  );
  const typed = new Map<string, string[]>();
  for (const chapter of demo.chapters) {
    for (const step of chapter.steps) {
      if (actionOf(step) !== 'type') continue;
      const parts = typed.get(step.type ?? '') ?? [];
      if (step.part) parts.push(step.part);
      typed.set(step.type ?? '', parts);
    }
  }
  const types = [...typed]
    .map(([name, parts]) =>
      parts.length ? `${name} (${parts.join(', ')})` : name
    )
    .join(', ');
  const { name, workspace, sites } = demo.environment;
  return [
    `${demo.name}: ${demo.title}`,
    `  ${count(demo.opening.length, 'opening card')}, ${count(demo.chapters.length, 'chapter')} of ${count(steps, 'step')}${demo.recap ? ', a recap' : ''}`,
    `  types ${types || 'no File'}`,
    `  Environment ${name}: the workspace ${workspace}${Object.keys(sites).length ? `, the sites ${Object.keys(sites).join(', ')}` : ''}`
  ].join('\n');
};

// Puts each typed File in the workspace as the journey starts typing it: no file, or the text before its first part.
const prepare = (demo: IDemo) => {
  const { workspace } = demo.environment;
  for (const [path, text] of Object.entries(demo.prepared)) {
    const target = join(workspace, path);
    if (!target.startsWith(`${workspace}${sep}`))
      throw new Error(`${path} is outside the workspace`);
    if (text === null) rmSync(target, { force: true });
    else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
  }
};

const down = async (state: string) => {
  if (!existsSync(state)) {
    console.log('no demo is up');
    return;
  }
  let saved: IState | undefined;
  try {
    saved = JSON.parse(
      readFileSync(join(state, 'state.json'), 'utf8')
    ) as IState;
  } catch {
    console.error(`no state.json in ${state}: nothing to tear down`);
  }
  if (saved?.editor)
    await stopEditor(state, saved.editor.pid, saved.editor.port);
  let failed = false;
  for (const command of saved?.teardown ?? []) {
    try {
      run(command, saved?.root ?? process.cwd(), saved?.env ?? {});
    } catch (error) {
      failed = true;
      console.error((error as Error).message);
    }
  }
  rmSync(state, { recursive: true, force: true });
  if (failed) throw new Error('a teardown failed: see above');
  console.log('down');
};

const up = async (demo: IDemo) => {
  const state = stateOf(demo.folder);
  const folder = relative(process.cwd(), demo.folder) || '.';
  if (existsSync(state))
    throw new Error(
      `a demo is up (${state}): run demo.ts down ${folder} first`
    );
  const { environment } = demo;
  if (!environment.editor.acceptLicense) {
    throw new Error(
      `${environment.name}: VS Code's server asks to accept its license (https://aka.ms/vscode-server-license): ` +
        'set editor.acceptLicense: true in the Environment once you accept it'
    );
  }
  for (const port of localPorts(demo)) {
    if (await isPortTaken(port))
      throw new Error(`port ${port} is taken: stop what listens on it`);
  }
  mkdirSync(state, { recursive: true });
  const saved: IState = {
    root: demo.root,
    env: variables(demo, state),
    teardown: [demo.teardown, environment.teardown].filter(
      (command): command is string => command !== undefined
    )
  };
  saveState(state, saved);
  try {
    for (const command of [environment.setup, demo.setup, environment.start]) {
      if (command) run(command, demo.root, saved.env);
    }
    if (!existsSync(environment.workspace))
      throw new Error(`setup made no workspace at ${environment.workspace}`);
    writeEditorSettings(demo);
    await startEditor(demo, state, (pid) => {
      saved.editor = { pid, port: environment.editor.port };
      saveState(state, saved);
    });
  } catch (error) {
    console.error((error as Error).message);
    await down(state);
    throw new Error('setup failed: the demo is down', { cause: error });
  }
  console.log(
    `up: ${environment.workspace}, the editor on http://127.0.0.1:${environment.editor.port}`
  );
  return state;
};

const play = async (demo: IDemo, out: string, last?: number) => {
  if (!existsSync(stateOf(demo.folder))) {
    throw new Error(
      `no demo is up: run demo.ts up ${relative(process.cwd(), demo.folder) || '.'} first`
    );
  }
  prepare(demo);
  await playJourney(demo, resolve(out), last);
};

// Joins the parts into the video; when the journey played only some of them, says why it did not
const tryMerge = (out: string, demo: IDemo) => {
  try {
    mergeParts(resolve(out), demo);
  } catch (error) {
    console.log((error as Error).message);
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--chapters');
  const chaptersArg = flag === -1 ? undefined : args[flag + 1];
  const [command, folder, out, lastArg] =
    flag === -1 ? args : [...args.slice(0, flag), ...args.slice(flag + 2)];
  const needsOut = ['cards', 'play', 'render', 'merge', 'record'];
  if (
    !command ||
    !folder ||
    !['check', 'up', 'down', ...needsOut].includes(command) ||
    (needsOut.includes(command) && !out) ||
    (flag !== -1 && (command !== 'record' || !chaptersArg))
  ) {
    console.error(usage);
    process.exit(2);
  }
  const last = lastArg === undefined ? undefined : Number(lastArg);
  if (last !== undefined && !(Number.isInteger(last) && last >= 0))
    throw new Error(`the last chapter is a number, not ${lastArg}`);
  if (last !== undefined && chaptersArg !== undefined)
    throw new Error('record takes a last chapter or --chapters, not both');
  if (command === 'down') return down(stateOf(folder));
  const demo = loadDemo(folder);
  // the parts that --chapters names, and how far the journey plays to reach the last of them
  const names = partNames(demo);
  const only = chaptersArg
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of only ?? []) {
    if (!names.includes(name))
      throw new Error(`no part ${name}: the parts are ${names.join(', ')}`);
  }
  const reach = only
    ? only.includes('recap')
      ? demo.chapters.length
      : Math.max(
          0,
          ...only.map(
            (name) =>
              demo.chapters.findIndex((chapter) => chapter.name === name) + 1
          )
        )
    : last;
  switch (command) {
    case 'check':
      console.log(summary(demo));
      return;
    case 'cards': {
      const overflowing = await renderCards(demo, resolve(out));
      if (overflowing.length)
        throw new Error(`overflowing the screen: ${overflowing.join(', ')}`);
      return;
    }
    case 'up':
      await up(demo);
      return;
    case 'play':
      await play(demo, out, last);
      return;
    case 'render':
      renderParts(resolve(out), resolve(out), demo);
      tryMerge(out, demo);
      return;
    case 'merge':
      mergeParts(resolve(out), demo);
      return;
    case 'record': {
      const state = await up(demo);
      const stop = () => {
        down(state).finally(() => process.exit(130));
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      const video = join(state, 'video');
      try {
        // the chapters before the first part named play as written, to leave what it starts from; their video goes
        await play(demo, video, reach);
        mkdirSync(resolve(out), { recursive: true });
        renderParts(video, resolve(out), demo, only);
        // the whole demo, or the parts named with those kept, makes the video; a review of the first chapters does not
        if (last === undefined) mergeParts(resolve(out), demo);
        else tryMerge(out, demo);
      } catch (error) {
        // the state folder goes with the teardown: keep the page as it failed
        if (existsSync(join(video, 'failed.png'))) {
          mkdirSync(resolve(out), { recursive: true });
          copyFileSync(
            join(video, 'failed.png'),
            join(resolve(out), 'failed.png')
          );
        }
        throw error;
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        await down(state);
      }
      return;
    }
  }
};

try {
  await main();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
