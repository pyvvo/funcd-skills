// VS Code for the web, which the journey drives: the workspace's settings, then `code serve-web` started as a process
// group of its own, and stopped with it.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { delimiter, join } from 'node:path';
import type { IDemo } from './manifests.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The project's settings over the engine's, mappings merged key by key
const merge = (
  base: Record<string, unknown>,
  over: Record<string, unknown>
): Record<string, unknown> => {
  const merged = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const before = merged[key];
    merged[key] =
      isObject(before) && isObject(value) ? merge(before, value) : value;
  }
  return merged;
};

// A fresh profile's settings: no walkthrough, no AI, no suggestions while the journey types, no autosave, a long
// hover delay, as a tooltip shows a file's full path, and a terminal whose prompt names the demo's folder. VS Code for
// the web keeps user settings in the browser, so they go in the workspace.
export const editorSettings = (demo: IDemo) => {
  const { workspace, editor } = demo.environment;
  const profile = {
    path: '/bin/bash',
    args: ['--norc', '--noprofile'],
    env: {
      PS1: `\\[\\e[1;35m\\]${demo.terminal.prompt}\\[\\e[0m\\] ❯ `,
      PATH: process.env.PATH ?? '',
      BASH_SILENCE_DEPRECATION_WARNING: '1',
      ...editor.env
    }
  };
  const off = { other: 'off', comments: 'off', strings: 'off' };
  return merge(
    {
      'workbench.colorTheme': 'Default Dark Modern',
      'workbench.startupEditor': 'none',
      'files.exclude': {
        '**/.git': true,
        '**/.vscode': true,
        '**/node_modules': true
      },
      'explorer.compactFolders': false,
      'workbench.tips.enabled': false,
      'workbench.welcomePage.walkthroughs.openOnInstall': false,
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      'chat.disableAIFeatures': true,
      'security.workspace.trust.enabled': false,
      'editor.minimap.enabled': false,
      'workbench.hover.delay': 60000,
      'editor.wordWrap': 'on',
      'editor.fontSize': 15,
      'terminal.integrated.fontSize': 14,
      'editor.autoIndent': 'none',
      // YAML's defaults turn suggestions on again
      '[yaml]': {
        'editor.autoIndent': 'none',
        'editor.formatOnType': false,
        'editor.quickSuggestions': off,
        'editor.suggestOnTriggerCharacters': false,
        'editor.wordBasedSuggestions': 'off'
      },
      'editor.wordBasedSuggestions': 'off',
      'editor.quickSuggestions': {
        other: false,
        comments: false,
        strings: false
      },
      'editor.suggestOnTriggerCharacters': false,
      'editor.acceptSuggestionOnEnter': 'off',
      'editor.acceptSuggestionOnCommitCharacter': false,
      'editor.inlineSuggest.enabled': false,
      'editor.parameterHints.enabled': false,
      'editor.snippetSuggestions': 'none',
      'editor.tabCompletion': 'off',
      // nothing typed in for the journey: what it types is the file
      'editor.autoClosingQuotes': 'never',
      'editor.autoClosingBrackets': 'never',
      'editor.autoClosingComments': 'never',
      'editor.autoClosingOvertype': 'never',
      'editor.autoSurround': 'never',
      'editor.formatOnType': false,
      'editor.formatOnPaste': false,
      'editor.linkedEditing': false,
      'html.autoClosingTags': false,
      'javascript.autoClosingTags': false,
      'typescript.autoClosingTags': false,
      'javascript.suggest.completeJSDocs': false,
      'typescript.suggest.completeJSDocs': false,
      'emmet.showExpandedAbbreviation': 'never',
      'files.autoSave': 'off',
      'git.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.ignoreRecommendations': true,
      'window.commandCenter': false,
      'workbench.layoutControl.enabled': false,
      'terminal.integrated.cwd': join(workspace, demo.terminal.cwd),
      'terminal.integrated.defaultProfile.osx': 'demo',
      'terminal.integrated.defaultProfile.linux': 'demo',
      // the terminals outlive the editor's reloads, as when the journey comes back from a site
      'terminal.integrated.enablePersistentSessions': true,
      'terminal.integrated.showExitAlert': false,
      'terminal.integrated.profiles.osx': { demo: profile },
      'terminal.integrated.profiles.linux': { demo: profile }
    },
    editor.settings
  );
};

export const writeEditorSettings = (demo: IDemo) => {
  const folder = join(demo.environment.workspace, '.vscode');
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'settings.json'),
    `${JSON.stringify(editorSettings(demo), null, 2)}\n`
  );
};

// Whether something listens on a local port, on IPv4 or IPv6
export const isPortTaken = async (port: number) => {
  const answers = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ host, port });
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => resolve(false));
    });
  return (await answers('127.0.0.1')) || (await answers('::1'));
};

// VS Code's `code` command: the first on the PATH, but for the one that a VS Code server puts first in its own
// terminals, which opens files in that editor, as when the engine runs inside a demo
const codeCommand = () =>
  (process.env.PATH ?? '')
    .split(delimiter)
    .filter((folder) => folder !== '' && !folder.includes('remote-cli'))
    .map((folder) => join(folder, 'code'))
    .find((path) => existsSync(path));

const serverEnv = () => {
  const { VSCODE_IPC_HOOK_CLI: _, ...env } = process.env;
  return env;
};

// Starts `code serve-web` on the workspace, in a process group of its own, and waits until it answers. Its output
// goes to editor.log in the state folder.
export const startEditor = async (
  demo: IDemo,
  state: string,
  onStart: (pid: number) => void
) => {
  const { port, commit } = demo.environment.editor;
  const code = codeCommand();
  if (!code || spawnSync(code, ['--version'], { stdio: 'ignore' }).error)
    throw new Error('no VS Code `code` command on the PATH');
  const log = openSync(join(state, 'editor.log'), 'a');
  const child = spawn(
    code,
    [
      'serve-web',
      ...(commit ? ['--commit-id', commit] : []),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--without-connection-token',
      '--accept-server-license-terms',
      '--disable-telemetry',
      '--server-data-dir',
      join(state, 'editor')
    ],
    // a VS Code terminal's link to its own editor, which this server is not
    { detached: true, stdio: ['ignore', log, log], env: serverEnv() }
  );
  child.unref();
  if (child.pid === undefined) throw new Error('code serve-web did not start');
  onStart(child.pid);
  // the first start of a commit downloads its server
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`http://127.0.0.1:${port}/`)
      .then((res) => res.ok)
      .catch(() => false);
    if (ok) return;
    await sleep(1000);
  }
  throw new Error(`VS Code did not start: ${join(state, 'editor.log')}`);
};

// Stops the editor's process group, then any process that names the state folder, as the server started by it.
export const stopEditor = async (state: string, pid: number, port: number) => {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // already stopped
  }
  for (let at = 0; at < 20 && (await isPortTaken(port)); at += 1)
    await sleep(500);
  spawnSync('pkill', ['-f', state], { stdio: 'ignore' });
  for (let at = 0; at < 10 && (await isPortTaken(port)); at += 1)
    await sleep(500);
  if (await isPortTaken(port))
    console.error(`port ${port} still answers: stop what listens on it`);
};
