// A demo is a folder of YAML manifests (references/manifests.md): read with yq, checked, then resolved into what the
// journey plays. A mistake fails before anything runs, and every problem is named at once.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  type CardType,
  type IChapterTitle,
  treeOfFiles,
  layouts
} from './slides.ts';

// One step of a chapter: one action, named by its key, with its own keys, and `hold`, the seconds to wait after it.
export interface IStep {
  // the editor: Files, the Explorer's folders, VS Code's commands and its terminal
  open?: string;
  collapse?: string;
  type?: string;
  part?: string;
  command?: string;
  language?: string;
  run?: string;
  terminal?: string;
  panel?: string;
  scroll?: number;
  reveal?: string;
  // the caption, on any page
  caption?: string;
  detail?: string;
  // a page: the editor, a site (<site>:/…) or a URL, and a text it shows once loaded
  page?: string;
  shows?: string;
  scrollTo?: string;
  pick?: string;
  option?: string | number;
  upload?: string;
  file?: string;
  // a page's elements, as a person uses them: a click by name, a field typed in, a key
  click?: string;
  fill?: string;
  value?: string;
  press?: string;
  // what the journey waits for: a URL's answer, a File, or a text on the page
  wait?: string;
  url?: string;
  method?: string;
  body?: string;
  until?: string;
  text?: string;
  timeout?: number;
  speed?: number;
  // a Card, by its name
  card?: string;
  hold?: number;
}

// A step as the journey plays it: where it is written, for its errors, and for `type`, the text it types.
export interface IPlayStep extends IStep {
  where: string;
  typing?: string;
}

// A part of a File, between two of its lines: `from` is its first line, `until` the line after its last.
interface IPart {
  from?: string;
  until?: string;
}

export interface IFile {
  name: string;
  // from the project's root, which is the same in the workspace
  path: string;
  // the file whose text `type` types, when it is not the project's own file at `path`
  source?: string;
  comment?: string;
  parts?: Record<string, IPart>;
}

export interface IChapter extends IChapterTitle {
  name: string;
  // how long its card shows, 4 seconds by default
  cardSeconds?: number;
  steps: IPlayStep[];
}

export interface IEnvironment {
  name: string;
  // the folder that setup makes, a copy of the project, which the editor opens
  workspace: string;
  // setup makes the workspace, the Demo's setup changes it, then start starts the services that the sites serve
  setup?: string;
  start?: string;
  teardown?: string;
  sites: Record<string, string>;
  editor: {
    port: number;
    commit?: string;
    acceptLicense: boolean;
    env: Record<string, string>;
    settings: Record<string, unknown>;
  };
  viewport: { width: number; height: number };
  // a browser's address bar above a site's page
  addressBar: boolean;
  typingDelay: number;
}

// A demo, resolved: each name replaced by what it names, and each Steps used expanded where it is used.
export interface IDemo {
  // the project's root, where every path of the manifests starts
  root: string;
  folder: string;
  name: string;
  title: string;
  setup?: string;
  teardown?: string;
  terminal: { cwd: string; prompt: string };
  environment: IEnvironment;
  opening: CardType[];
  chapters: IChapter[];
  recap?: CardType;
  // the Cards, by name
  cards: Record<string, CardType>;
  files: Record<string, IFile>;
  // what each typed File holds in the workspace when the journey starts, by its path: the text before its first typed
  // part, or null for no file
  prepared: Record<string, string | null>;
}

// A YAML document of a manifest file
interface IDoc {
  // from the project's root
  file: string;
  // its place in the file, from 1
  index: number;
  value: Record<string, unknown>;
}

interface IParam {
  name: string;
  default?: unknown;
}

// Each kind and its keys besides `kind` and `name`
const kinds: Record<string, string[]> = {
  Demo: [
    'title',
    'environment',
    'include',
    'setup',
    'teardown',
    'terminal',
    'opening',
    'chapters',
    'recap'
  ],
  Environment: [
    'workspace',
    'setup',
    'start',
    'teardown',
    'sites',
    'editor',
    'viewport',
    'typingDelay',
    'addressBar'
  ],
  Card: [
    'layout',
    'kicker',
    'title',
    'seconds',
    'paragraphs',
    'items',
    'footer',
    'tree',
    'files',
    'root',
    'compact'
  ],
  File: ['path', 'source', 'comment', 'parts'],
  Steps: ['params', 'steps'],
  Chapter: ['title', 'detail', 'cardSeconds', 'steps']
};

// Each action and the keys it takes besides its own and `hold`. `use` is expanded when the demo loads.
const actions: Record<string, string[]> = {
  open: [],
  collapse: [],
  type: ['part'],
  command: [],
  language: [],
  run: [],
  terminal: [],
  panel: [],
  scroll: [],
  reveal: [],
  caption: ['detail'],
  page: ['caption', 'detail', 'shows'],
  scrollTo: [],
  pick: ['option'],
  upload: ['file'],
  click: [],
  fill: ['value'],
  press: [],
  wait: ['url', 'method', 'body', 'until', 'file', 'text', 'timeout', 'speed'],
  card: [],
  hold: [],
  use: ['with']
};

const editorDefaults = {
  port: 8799,
  viewport: { width: 1280, height: 720 },
  typingDelay: 18
};

// The action of a step: its first key that names an action, `hold` only when it has no other.
export const actionOf = (step: IStep) =>
  Object.keys(step).find((key) => key !== 'hold' && key in actions) ?? 'hold';

const namePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

// A path from the project's root, which stays inside it
const isPath = (value: unknown): value is string =>
  isText(value) && !isAbsolute(value) && !value.split('/').includes('..');

const isSeconds = (value: unknown) =>
  value === undefined || (typeof value === 'number' && value > 0);

// The first line of a failed command's error, as yq prints it
const firstLine = (error: unknown) => {
  const stderr = (error as { stderr?: Buffer | string }).stderr;
  const text = stderr ? String(stderr) : (error as Error).message;
  return text
    .trim()
    .split('\n')[0]
    .replace(/^Error: /, '');
};

// The project's root: the git checkout that holds the folder, else the current folder
const projectRoot = (folder: string) => {
  try {
    return execFileSync('git', ['-C', folder, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return process.cwd();
  }
};

// A folder's manifest files, in their names' order, or the file itself
const yamlFiles = (path: string) =>
  statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((name) => name.endsWith('.yaml'))
        .sort()
        .map((name) => join(path, name))
    : [path];

// The documents of a YAML file, as yq reads them, aliases expanded; a document of only comments is none
const readDocs = (root: string, path: string): IDoc[] => {
  const output = execFileSync('yq', ['-o=json', '-I=0', 'explode(.)', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return output
    .split('\n')
    .filter((line) => line !== '')
    .map((line, at) => ({
      file: relative(root, path),
      index: at + 1,
      value: JSON.parse(line) as Record<string, unknown>
    }))
    .filter((doc) => doc.value !== null);
};

// The lines of a part, as [first, after the last], or what is wrong with it
const lineRange = (lines: string[], part: IPart): [number, number] | string => {
  const start = part.from === undefined ? 0 : lines.indexOf(part.from);
  if (start === -1) return `no line ${JSON.stringify(part.from)}`;
  if (part.until === undefined) return [start, lines.length];
  const end = lines.indexOf(
    part.until,
    part.from === undefined ? 0 : start + 1
  );
  if (end === -1) return `no line ${JSON.stringify(part.until)} after it`;
  if (end === start) return 'an empty part';
  return [start, end];
};

// The text of lines [start, end): the file's own end when the part ends it, else a line break after its last line
const textOf = (lines: string[], [start, end]: [number, number]) =>
  end === lines.length
    ? lines.slice(start).join('\n')
    : `${lines.slice(start, end).join('\n')}\n`;

// The folder that holds every path
const commonFolder = (paths: string[]) => {
  const folders = paths.map((path) => path.split('/').slice(0, -1));
  const common: string[] = [];
  for (const [at, name] of (folders[0] ?? []).entries()) {
    if (folders.some((parts) => parts[at] !== name)) break;
    common.push(name);
  }
  return common.join('/');
};

// Reads a demo's folder, and the files its Demo includes, then checks and resolves it: every problem in one error.
export const loadDemo = (folderArg: string): IDemo => {
  const folder = resolve(folderArg);
  if (!existsSync(folder) || !statSync(folder).isDirectory())
    throw new Error(`no folder ${folderArg}`);
  const root = projectRoot(folder);
  if (relative(root, folder).startsWith('..'))
    throw new Error(`${folderArg} is outside the project, ${root}`);
  try {
    execFileSync('yq', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error("no yq on the PATH: install mikefarah's yq");
  }

  const problems: string[] = [];
  const fail = (): never => {
    throw new Error(
      `${relative(root, folder) || '.'}:\n  ${problems.join('\n  ')}`
    );
  };
  const docs: IDoc[] = [];
  const read = new Set<string>();
  const readPath = (path: string) => {
    for (const file of yamlFiles(path)) {
      if (read.has(file)) continue;
      read.add(file);
      try {
        docs.push(...readDocs(root, file));
      } catch (error) {
        problems.push(`${relative(root, file)}: ${firstLine(error)}`);
      }
    }
  };
  readPath(folder);
  const label = (doc: IDoc) =>
    `${doc.file}: ${String(doc.value.kind)} ${String(doc.value.name)}`;

  const isDemo = (doc: IDoc) =>
    isObject(doc.value) && doc.value.kind === 'Demo';
  const demos = docs.filter(isDemo);
  if (demos.length !== 1) {
    problems.push(`${demos.length} Demo manifests, want one`);
    fail();
  }
  const demoDoc = demos[0];
  const demo = demoDoc.value;
  const demoLabel = label(demoDoc);
  const include = demo.include ?? [];
  if (!Array.isArray(include)) {
    problems.push(`${demoLabel}: include is a list of paths`);
  } else {
    for (const path of include) {
      if (!isPath(path)) {
        problems.push(
          `${demoLabel}: include takes paths from the project's root, not ${String(path)}`
        );
      } else if (!existsSync(join(root, path))) {
        problems.push(`${demoLabel}: no file or folder ${path} to include`);
      } else readPath(join(root, path));
    }
  }
  if (docs.filter(isDemo).length > 1)
    problems.push(`${demoLabel}: an included file holds another Demo`);

  // Each manifest by its kind and its name
  const named = new Map<string, Map<string, IDoc>>();
  const ofKind = (kind: string) => [...(named.get(kind)?.values() ?? [])];
  for (const doc of docs) {
    const where = `${doc.file}, document ${doc.index}`;
    if (!isObject(doc.value)) {
      problems.push(`${where}: a manifest is a mapping`);
      continue;
    }
    const { kind, name } = doc.value;
    if (typeof kind !== 'string' || !(kind in kinds)) {
      problems.push(
        `${where}: kind is ${Object.keys(kinds).join(', ')}, not ${String(kind)}`
      );
      continue;
    }
    if (typeof name !== 'string' || !namePattern.test(name)) {
      problems.push(
        `${where}: a ${kind}'s name is lowercase words joined by hyphens, not ${String(name)}`
      );
      continue;
    }
    for (const key of Object.keys(doc.value)) {
      if (key !== 'kind' && key !== 'name' && !kinds[kind].includes(key)) {
        problems.push(
          `${label(doc)}: no key ${key}; a ${kind} takes ${kinds[kind].join(', ')}`
        );
      }
    }
    const byName = named.get(kind) ?? new Map<string, IDoc>();
    named.set(kind, byName);
    const other = byName.get(name);
    if (other) {
      problems.push(
        `${label(doc)}: ${other.file} has a ${String(other.value.kind)} of that name`
      );
      continue;
    }
    byName.set(name, doc);
  }

  // Values of the environment, in a text: ${NAME}
  const vars: Record<string, string | undefined> = {
    ...process.env,
    TMPDIR: tmpdir()
  };
  const expand = (text: string, where: string) =>
    text.replace(/\$\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      if (value !== undefined) return value;
      problems.push(`${where}: no variable ${name}`);
      return match;
    });

  // The Environment
  const envName = demo.environment;
  const envDoc = isText(envName)
    ? named.get('Environment')?.get(envName)
    : undefined;
  if (!envDoc) problems.push(`${demoLabel}: no Environment ${String(envName)}`);
  const env = envDoc?.value ?? {};
  const envLabel = envDoc ? label(envDoc) : demoLabel;
  let workspace = '';
  if (!isText(env.workspace)) {
    if (envDoc)
      problems.push(
        `${envLabel}: workspace is the folder that setup makes, a copy of the project`
      );
  } else {
    const path = expand(env.workspace, `${envLabel}, workspace`);
    if (!isAbsolute(path)) {
      problems.push(
        `${envLabel}: workspace is an absolute path, such as \${TMPDIR}/<project>-demo/repo`
      );
    } else {
      workspace = resolve(path);
      const toRoot = relative(workspace, root);
      if (!toRoot.startsWith('..') && !isAbsolute(toRoot)) {
        problems.push(
          `${envLabel}: workspace ${workspace} holds the project: it must be a copy, which the journey changes`
        );
      }
    }
  }
  vars.DEMO_PROJECT = root;
  vars.DEMO_FOLDER = folder;
  vars.DEMO_WORKSPACE = workspace;

  const sites: Record<string, string> = {};
  if (env.sites !== undefined && !isObject(env.sites))
    problems.push(`${envLabel}: sites maps names to URLs`);
  for (const [name, url] of Object.entries(
    isObject(env.sites) ? env.sites : {}
  )) {
    if (!namePattern.test(name) || name === 'editor') {
      problems.push(
        `${envLabel}: a site's name is lowercase words joined by hyphens, and not editor: ${name}`
      );
    } else if (typeof url !== 'string' || !/^https?:\/\/[^/]+/.test(url)) {
      problems.push(`${envLabel}: site ${name} is an http or https URL`);
    } else sites[name] = url.replace(/\/+$/, '');
  }

  const editor = isObject(env.editor) ? env.editor : {};
  if (env.editor !== undefined && !isObject(env.editor))
    problems.push(`${envLabel}: editor is a mapping`);
  const port = editor.port ?? editorDefaults.port;
  if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535)
    problems.push(`${envLabel}: editor.port is a port, not ${String(port)}`);
  if (editor.commit !== undefined && !isText(editor.commit))
    problems.push(`${envLabel}: editor.commit is a VS Code commit`);
  if (
    editor.acceptLicense !== undefined &&
    typeof editor.acceptLicense !== 'boolean'
  )
    problems.push(`${envLabel}: editor.acceptLicense is true or false`);
  const editorEnv: Record<string, string> = {};
  if (editor.env !== undefined && !isObject(editor.env))
    problems.push(`${envLabel}: editor.env maps names to texts`);
  for (const [name, value] of Object.entries(
    isObject(editor.env) ? editor.env : {}
  )) {
    if (typeof value !== 'string' && typeof value !== 'number')
      problems.push(`${envLabel}: editor.env.${name} is a text`);
    else editorEnv[name] = expand(String(value), `${envLabel}, editor.env`);
  }
  if (editor.settings !== undefined && !isObject(editor.settings))
    problems.push(`${envLabel}: editor.settings maps VS Code settings`);

  const viewport = isObject(env.viewport)
    ? env.viewport
    : editorDefaults.viewport;
  if (
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    Number(viewport.width) <= 0 ||
    Number(viewport.height) <= 0
  )
    problems.push(`${envLabel}: viewport has a width and a height in pixels`);
  const typingDelay = env.typingDelay ?? editorDefaults.typingDelay;
  if (typeof typingDelay !== 'number' || typingDelay < 0)
    problems.push(`${envLabel}: typingDelay is milliseconds a character`);
  if (env.addressBar !== undefined && typeof env.addressBar !== 'boolean')
    problems.push(`${envLabel}: addressBar is true or false`);
  for (const key of ['setup', 'start', 'teardown']) {
    if (env[key] !== undefined && !isText(env[key]))
      problems.push(`${envLabel}: ${key} is a command`);
    if (key !== 'start' && demo[key] !== undefined && !isText(demo[key]))
      problems.push(`${demoLabel}: ${key} is a command`);
  }

  const environment: IEnvironment = {
    name: String(envName),
    workspace,
    setup: env.setup as string | undefined,
    start: env.start as string | undefined,
    teardown: env.teardown as string | undefined,
    sites,
    editor: {
      port: Number(port),
      commit: editor.commit as string | undefined,
      acceptLicense: editor.acceptLicense === true,
      env: editorEnv,
      settings: isObject(editor.settings) ? editor.settings : {}
    },
    viewport: {
      width: Number(viewport.width),
      height: Number(viewport.height)
    },
    typingDelay: Number(typingDelay),
    addressBar: env.addressBar === true
  };

  // The Files, and the text of each one that has parts or that a step types, read from the project
  const files: Record<string, IFile> = {};
  const texts = new Map<string, string[] | null>();
  const linesOf = (file: IFile, where: string) => {
    if (!texts.has(file.name)) {
      const path = join(root, file.source ?? file.path);
      if (existsSync(path) && statSync(path).isFile()) {
        texts.set(file.name, readFileSync(path, 'utf8').split('\n'));
      } else {
        texts.set(file.name, null);
        problems.push(
          `${where}: no file ${file.source ?? file.path} in the project, whose text File ${file.name} types`
        );
      }
    }
    return texts.get(file.name) ?? undefined;
  };
  for (const doc of ofKind('File')) {
    const value = doc.value;
    const where = label(doc);
    if (
      !isPath(value.path) ||
      value.path.endsWith('/') ||
      value.path
        .split('/')
        .slice(0, -1)
        .some((part) => part.includes('*'))
    ) {
      problems.push(
        `${where}: path is a file's path from the project's root, with a * in its name only`
      );
      continue;
    }
    if (
      value.source !== undefined &&
      (!isPath(value.source) || value.source.includes('*'))
    )
      problems.push(
        `${where}: source is a file's path from the project's root`
      );
    if (value.comment !== undefined && !isText(value.comment))
      problems.push(`${where}: comment is a text`);
    const parts: Record<string, IPart> = {};
    if (value.parts !== undefined && !isObject(value.parts))
      problems.push(`${where}: parts maps names to a from and an until`);
    for (const [name, part] of Object.entries(
      isObject(value.parts) ? value.parts : {}
    )) {
      if (
        !isObject(part) ||
        (part.from === undefined && part.until === undefined) ||
        Object.keys(part).some((key) => key !== 'from' && key !== 'until') ||
        (part.from !== undefined && typeof part.from !== 'string') ||
        (part.until !== undefined && typeof part.until !== 'string')
      ) {
        problems.push(
          `${where}: part ${name} takes from, until or both, lines of the file`
        );
      } else {
        parts[name] = {
          from: part.from as string | undefined,
          until: part.until as string | undefined
        };
      }
    }
    const file: IFile = {
      name: String(value.name),
      path: value.path,
      source: isPath(value.source) ? value.source : undefined,
      comment: isText(value.comment) ? value.comment : undefined,
      parts: Object.keys(parts).length ? parts : undefined
    };
    files[file.name] = file;
    for (const [name, part] of Object.entries(parts)) {
      const lines = linesOf(file, where);
      const range = lines ? lineRange(lines, part) : undefined;
      if (typeof range === 'string')
        problems.push(`${where}: part ${name}: ${range}`);
    }
  }

  // The Cards: a tree card's tree is written, or drawn from Files, their paths and comments
  const cards: Record<string, CardType> = {};
  const cardKeys = [
    'paragraphs',
    'items',
    'footer',
    'tree',
    'files',
    'root',
    'compact'
  ];
  const keysOf: Record<string, string[]> = {
    text: ['paragraphs'],
    list: ['items', 'footer'],
    contents: [],
    tree: ['tree', 'files', 'root', 'compact']
  };
  for (const doc of ofKind('Card')) {
    const value = doc.value;
    const where = label(doc);
    const name = String(value.name);
    if (!isText(value.kicker) || !isText(value.title))
      problems.push(`${where}: a card needs kicker and title`);
    if (!isSeconds(value.seconds))
      problems.push(`${where}: seconds is how long it shows`);
    if (value.compact !== undefined && typeof value.compact !== 'boolean')
      problems.push(`${where}: compact is true or false`);
    const layout = value.layout;
    if (typeof layout !== 'string' || !layouts.includes(layout)) {
      problems.push(
        `${where}: layout is ${layouts.join(', ')}, not ${String(layout)}`
      );
      continue;
    }
    for (const key of cardKeys) {
      if (value[key] !== undefined && !keysOf[layout].includes(key))
        problems.push(`${where}: a ${layout} card takes no ${key}`);
    }
    const isTexts = (key: string) =>
      Array.isArray(value[key]) &&
      (value[key] as unknown[]).length > 0 &&
      (value[key] as unknown[]).every(isText);
    if (layout === 'text' && !isTexts('paragraphs'))
      problems.push(`${where}: a text card needs paragraphs`);
    if (layout === 'list' && !isTexts('items'))
      problems.push(`${where}: a list card needs items`);
    if (
      layout === 'list' &&
      value.footer !== undefined &&
      !isText(value.footer)
    )
      problems.push(`${where}: footer is a text`);
    if (
      layout === 'tree' &&
      (value.tree === undefined) === (value.files === undefined)
    )
      problems.push(
        `${where}: a tree card takes tree, written, or files, drawn from Files`
      );
    if (layout === 'tree' && value.tree !== undefined && !isText(value.tree))
      problems.push(`${where}: tree is a folder's tree`);
    if (value.root !== undefined && value.files === undefined)
      problems.push(`${where}: root goes with files`);
    const base = {
      kicker: String(value.kicker),
      title: String(value.title),
      ...(value.seconds === undefined ? {} : { seconds: Number(value.seconds) })
    };
    if (layout === 'tree' && value.files !== undefined) {
      const names = Array.isArray(value.files) ? value.files : [];
      if (!names.length)
        problems.push(`${where}: files lists the Files that its tree shows`);
      const shown = names
        .map((each) => files[String(each)])
        .filter((file): file is IFile => file !== undefined);
      for (const each of names) {
        if (!files[String(each)])
          problems.push(`${where}: no File ${String(each)}`);
      }
      const top =
        value.root === undefined
          ? commonFolder(shown.map((file) => file.path))
          : value.root === '.'
            ? ''
            : String(value.root).replace(/\/+$/, '');
      if (value.root !== undefined && value.root !== '.' && !isPath(value.root))
        problems.push(
          `${where}: root is a folder's path from the project's root`
        );
      for (const file of shown) {
        if (top !== '' && !file.path.startsWith(`${top}/`))
          problems.push(`${where}: File ${file.name} is not in ${top}`);
      }
      const entries = shown.map((file) => ({
        path: top === '' ? file.path : file.path.slice(top.length + 1),
        comment: file.comment
      }));
      cards[name] = {
        layout: 'tree',
        ...base,
        tree: treeOfFiles(top, entries),
        ...(value.compact === true ? { compact: true } : {})
      };
      continue;
    }
    const extra = Object.fromEntries(
      keysOf[layout]
        .filter((key) => key !== 'files' && key !== 'root')
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]])
    );
    cards[name] = { ...base, layout, ...extra } as unknown as CardType;
  }

  // The Steps, expanded where a step uses them
  const templates = new Map<
    string,
    { params: IParam[]; steps: unknown; where: string }
  >();
  for (const doc of ofKind('Steps')) {
    const where = label(doc);
    const params: IParam[] = [];
    const given = doc.value.params ?? [];
    if (!Array.isArray(given))
      problems.push(`${where}: params lists names, or a name and a default`);
    for (const param of Array.isArray(given) ? given : []) {
      if (typeof param === 'string' && /^\w+$/.test(param)) {
        params.push({ name: param });
      } else if (
        isObject(param) &&
        typeof param.name === 'string' &&
        /^\w+$/.test(param.name) &&
        Object.keys(param).every((key) => key === 'name' || key === 'default')
      ) {
        params.push(
          'default' in param
            ? { name: param.name, default: param.default }
            : { name: param.name }
        );
      } else {
        problems.push(
          `${where}: a param is a name, or a name and a default, not ${JSON.stringify(param)}`
        );
      }
    }
    templates.set(String(doc.value.name), {
      params,
      steps: doc.value.steps,
      where
    });
  }

  // A template's value, each ${param} replaced; a text that is only ${param} takes the value as it is
  const substitute = (
    value: unknown,
    values: Record<string, unknown>,
    params: IParam[],
    where: string,
    key = ''
  ): unknown => {
    if (typeof value === 'string') {
      const whole = /^\$\{(\w+)\}$/.exec(value);
      if (whole && whole[1] in values) return values[whole[1]];
      return value.replace(/\$\{(\w+)\}/g, (match, name: string) => {
        if (name in values) return String(values[name]);
        // `until` is JavaScript, whose template literals look the same; a param not given is named once, above
        if (key !== 'until' && !params.some((param) => param.name === name))
          problems.push(`${where}: ${match} is no param`);
        return match;
      });
    }
    if (Array.isArray(value))
      return value.map((each) => substitute(each, values, params, where, key));
    if (isObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([name, each]) => [
          name,
          substitute(each, values, params, where, name)
        ])
      );
    }
    return value;
  };

  const expandSteps = (
    steps: unknown,
    where: string,
    stack: string[]
  ): IPlayStep[] => {
    if (!Array.isArray(steps) || steps.length === 0) {
      problems.push(`${where}: no steps`);
      return [];
    }
    return steps.flatMap((step, at): IPlayStep[] => {
      const here = `${where}, step ${at + 1}`;
      if (!isObject(step)) {
        problems.push(`${here}: a step is a mapping`);
        return [];
      }
      if (actionOf(step) !== 'use') return [{ ...step, where: here }];
      const name = String(step.use);
      const template = templates.get(name);
      if (!template) {
        problems.push(`${here}: no Steps ${name}`);
        return [];
      }
      if (stack.includes(name)) {
        problems.push(`${here}: Steps ${name} uses itself`);
        return [];
      }
      for (const key of Object.keys(step)) {
        if (key !== 'use' && key !== 'with')
          problems.push(`${here}: use takes no ${key}`);
      }
      const given = step.with ?? {};
      if (!isObject(given)) {
        problems.push(`${here}: with maps the params of ${name} to values`);
        return [];
      }
      const values: Record<string, unknown> = {};
      for (const param of template.params) {
        if (param.name in given) values[param.name] = given[param.name];
        else if ('default' in param) values[param.name] = param.default;
        else problems.push(`${here}: Steps ${name} needs ${param.name}`);
      }
      for (const key of Object.keys(given)) {
        if (!template.params.some((param) => param.name === key))
          problems.push(`${here}: Steps ${name} has no param ${key}`);
      }
      const inside = `${here} (${name})`;
      return expandSteps(
        substitute(template.steps, values, template.params, inside),
        inside,
        [...stack, name]
      );
    });
  };

  // The Demo's cards and chapters, by name
  const cardOf = (name: unknown, where: string) => {
    const card = typeof name === 'string' ? cards[name] : undefined;
    if (!card) problems.push(`${where}: no Card ${String(name)}`);
    return card;
  };
  if (!isText(demo.title))
    problems.push(`${demoLabel}: title is the demo's name`);
  if (!Array.isArray(demo.opening) || !demo.opening.length)
    problems.push(
      `${demoLabel}: opening lists the cards before the first chapter`
    );
  const opening = (Array.isArray(demo.opening) ? demo.opening : [])
    .map((name) => cardOf(name, `${demoLabel}, opening`))
    .filter((card): card is CardType => card !== undefined);
  const recap =
    demo.recap === undefined
      ? undefined
      : cardOf(demo.recap, `${demoLabel}, recap`);
  if (!Array.isArray(demo.chapters) || !demo.chapters.length)
    problems.push(`${demoLabel}: chapters lists the Chapters in order`);
  const listed = Array.isArray(demo.chapters) ? demo.chapters.map(String) : [];
  const chapters: IChapter[] = [];
  for (const name of listed) {
    const doc = named.get('Chapter')?.get(name);
    if (!doc) {
      problems.push(`${demoLabel}: no Chapter ${name}`);
      continue;
    }
    const where = label(doc);
    if (!isText(doc.value.title) || !isText(doc.value.detail))
      problems.push(`${where}: a chapter needs title and detail`);
    if (!isSeconds(doc.value.cardSeconds))
      problems.push(`${where}: cardSeconds is how long its card shows`);
    chapters.push({
      name,
      title: String(doc.value.title),
      detail: String(doc.value.detail),
      ...(doc.value.cardSeconds === undefined
        ? {}
        : { cardSeconds: Number(doc.value.cardSeconds) }),
      steps: expandSteps(doc.value.steps, where, [])
    });
  }
  for (const doc of ofKind('Chapter')) {
    if (!listed.includes(String(doc.value.name)))
      problems.push(`${label(doc)}: not in the Demo's chapters`);
  }

  const terminal = isObject(demo.terminal) ? demo.terminal : {};
  if (demo.terminal !== undefined && !isObject(demo.terminal))
    problems.push(`${demoLabel}: terminal takes cwd and prompt`);
  if (terminal.cwd !== undefined && !isPath(terminal.cwd))
    problems.push(
      `${demoLabel}: terminal.cwd is a folder's path from the project's root`
    );
  if (terminal.prompt !== undefined && !isText(terminal.prompt))
    problems.push(`${demoLabel}: terminal.prompt is a text`);
  const cwd = isPath(terminal.cwd) ? terminal.cwd : '.';

  // Each step's action, and what it names
  const urlProblem = (url: unknown, isPage: boolean) => {
    if (typeof url === 'string') {
      if ((isPage && url === 'editor') || /^https?:\/\//.test(url)) return;
      const site = /^([a-z0-9-]+):/.exec(url)?.[1];
      if (site && site in sites) return;
    }
    const starts = [
      ...(isPage ? ['editor'] : []),
      ...Object.keys(sites).map((site) => `${site}:`),
      'http'
    ];
    return `starts with ${starts.join(', ')}, not ${String(url)}`;
  };
  const checkStep = (step: IPlayStep) => {
    const here = step.where;
    const keys = Object.keys(step).filter((key) => key !== 'where');
    const action = actionOf(step);
    if (action === 'hold' && !keys.includes('hold')) {
      problems.push(
        `${here}: no action among ${Object.keys(actions).join(', ')}`
      );
      return;
    }
    const allowed = new Set([action, 'hold', ...actions[action]]);
    for (const key of keys) {
      if (!allowed.has(key))
        problems.push(`${here}: ${action} takes no ${key}`);
    }
    if (
      step.hold !== undefined &&
      !(typeof step.hold === 'number' && step.hold >= 0)
    )
      problems.push(`${here}: hold is seconds, not ${String(step.hold)}`);
    const isFile = (key: 'open' | 'type' | 'file') => {
      if (!(typeof step[key] === 'string' && step[key] in files))
        problems.push(`${here}: ${key} names a File, not ${String(step[key])}`);
    };
    const isTextOf = (key: keyof IStep) => {
      if (!isText(step[key])) problems.push(`${here}: ${key} is a text`);
    };
    switch (action) {
      case 'open':
        isFile('open');
        break;
      case 'collapse':
        if (!isPath(step.collapse))
          problems.push(
            `${here}: collapse is a folder's path from the project's root`
          );
        break;
      case 'type':
        isFile('type');
        if (files[String(step.type)]?.path.includes('*'))
          problems.push(
            `${here}: a File that type types has its whole name, with no *`
          );
        if (
          step.part !== undefined &&
          !files[String(step.type)]?.parts?.[String(step.part)]
        )
          problems.push(
            `${here}: File ${String(step.type)} has no part ${String(step.part)}`
          );
        break;
      case 'command':
      case 'language':
      case 'run':
      case 'reveal':
      case 'scrollTo':
        isTextOf(action);
        break;
      case 'terminal':
        if (step.terminal !== 'split')
          problems.push(`${here}: terminal is split`);
        break;
      case 'panel':
        if (step.panel !== 'hide' && step.panel !== 'show')
          problems.push(`${here}: panel is hide or show`);
        break;
      case 'scroll':
        if (!(typeof step.scroll === 'number' && step.scroll > 0))
          problems.push(`${here}: scroll is a number of lines`);
        break;
      case 'caption':
        if (typeof step.caption !== 'string')
          problems.push(`${here}: caption is a text, '' to hide it`);
        break;
      case 'page': {
        const problem = urlProblem(step.page, true);
        if (problem) problems.push(`${here}: page ${problem}`);
        if (step.caption !== undefined && typeof step.caption !== 'string')
          problems.push(`${here}: caption is a text`);
        break;
      }
      case 'pick':
        isTextOf('pick');
        if (step.option === undefined)
          problems.push(`${here}: pick needs option`);
        break;
      case 'upload':
        isTextOf('upload');
        isFile('file');
        break;
      case 'click':
      case 'press':
        isTextOf(action);
        break;
      case 'fill':
        isTextOf('fill');
        if (typeof step.value !== 'string' && typeof step.value !== 'number')
          problems.push(`${here}: fill needs value, the text that it types`);
        break;
      case 'wait': {
        isTextOf('wait');
        const what = ['url', 'file', 'text'].filter((key) => key in step);
        if (what.length !== 1)
          problems.push(`${here}: wait takes one of url, file and text`);
        if (step.url !== undefined) {
          const problem = urlProblem(step.url, false);
          if (problem) problems.push(`${here}: url ${problem}`);
        } else {
          for (const key of ['method', 'body', 'until'] as const) {
            if (step[key] !== undefined)
              problems.push(`${here}: ${key} goes with url`);
          }
        }
        if (step.file !== undefined) isFile('file');
        if (step.text !== undefined) isTextOf('text');
        if (!isSeconds(step.timeout) || !isSeconds(step.speed))
          problems.push(
            `${here}: timeout is seconds, and speed how much faster the wait plays`
          );
        break;
      }
      case 'card':
        cardOf(step.card, here);
        if (step.hold !== undefined)
          problems.push(
            `${here}: card takes no hold: the card's seconds say how long it shows`
          );
        break;
    }
  };
  for (const chapter of chapters) chapter.steps.forEach(checkStep);

  // The text that each type step types: the parts of a File follow each other, each from where the one before ended
  const typedTo = new Map<string, number>();
  const prepared: Record<string, string | null> = {};
  for (const chapter of chapters) {
    for (const step of chapter.steps) {
      if (actionOf(step) !== 'type') continue;
      const file = files[String(step.type)];
      const part = step.part === undefined ? {} : file?.parts?.[step.part];
      const lines = file && part ? linesOf(file, step.where) : undefined;
      if (!file || !part || !lines) continue;
      const range = lineRange(lines, part);
      if (typeof range === 'string') continue;
      const end = typedTo.get(file.name);
      if (end === undefined) {
        prepared[file.path] =
          range[0] === 0 ? null : `${lines.slice(0, range[0]).join('\n')}\n`;
      } else if (range[0] !== end) {
        problems.push(
          `${step.where}: this part of ${file.name} starts at line ${range[0] + 1}, but what was typed before ends at line ${end}`
        );
      }
      typedTo.set(file.name, range[1]);
      step.typing = textOf(lines, range);
    }
  }

  if (problems.length) fail();
  return {
    root,
    folder,
    name: String(demo.name),
    title: String(demo.title),
    setup: demo.setup as string | undefined,
    teardown: demo.teardown as string | undefined,
    terminal: {
      cwd,
      prompt: isText(terminal.prompt)
        ? terminal.prompt
        : basename(cwd === '.' ? workspace : cwd)
    },
    environment,
    opening,
    chapters,
    recap,
    cards,
    files,
    prepared
  };
};
