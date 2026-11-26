// Plays a demo (references/manifests.md) in one browser page, which Playwright records as one video: the opening
// cards, then each chapter, opened by its card, step by step through VS Code for the web and the project's sites,
// then the recap card. `demo up` starts everything that it uses.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import type { Locator, Page } from 'playwright';
import {
  type IDemo,
  type IFile,
  type IPlayStep,
  actionOf
} from './manifests.ts';
import { renderCard, renderChapter } from './slides.ts';

// A part of the video that the render plays faster: a wait the viewer needs to see, but not in full.
export interface ISegment {
  start: number;
  end: number;
  speed: number;
}

// What the render needs, in journey.json: the recording, where its kept part begins, its length, its sped-up parts,
// and when the recap card shows
export interface IJourney {
  video: string;
  begin: number;
  duration: number;
  segments: ISegment[];
  recap?: number;
}

// A row of the editor's Explorer
interface IRow {
  index: number;
  level: number;
  name: string;
  expanded: string | null;
}

// A card waiting to be shown
interface ICardShow {
  html: string;
  seconds: number;
  isRecap?: boolean;
}

// Playwright, from the project: the engine ships no packages of its own.
export const playwright = (root: string) => {
  try {
    return createRequire(join(root, 'package.json'))(
      'playwright'
    ) as typeof import('playwright');
  } catch {
    throw new Error(
      `no playwright in ${root}: add it to the project's devDependencies, and its Chromium`
    );
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The overlay that every page gets: a caption at the bottom and a cursor that follows the mouse, which the video
// would not show otherwise.
const overlay = () => {
  const install = () => {
    // a card's frame gets no overlay: it would show the last caption inside the card
    if (window !== window.top || document.getElementById('demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #demo-cursor { position: fixed; z-index: 2147483647; width: 18px; height: 18px; margin: -9px 0 0 -9px;
        border-radius: 50%; background: rgba(255, 196, 0, 0.55); border: 2px solid rgba(255, 255, 255, 0.9);
        pointer-events: none; transition: transform 0.1s; left: -40px; top: -40px; }
      #demo-cursor.down { transform: scale(0.7); }
      #demo-caption { position: fixed; z-index: 2147483646; left: 14px; bottom: 34px; max-width: 320px;
        padding: 8px 12px; border-radius: 8px; background: rgba(28, 24, 52, 0.62); color: #fff;
        backdrop-filter: blur(3px); border-left: 3px solid #7c6cf2;
        font: 500 15px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        pointer-events: none; opacity: 0; transition: opacity 0.3s; }
      #demo-caption.shown { opacity: 1; }
      #demo-caption small { display: block; font-size: 12.5px; font-weight: 400; opacity: 0.8; }
      .demo-slide { position: fixed; inset: 0; z-index: 2147483645; width: 100%; height: 100%; border: 0;
        opacity: 0; transition: opacity 0.4s; background: #0d0d14; }
      .demo-slide.shown { opacity: 1; }
      body.demo-slides #demo-cursor, body.demo-slides #demo-caption { display: none !important; }`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    document.body.append(cursor, caption);
    // a caption belongs to its site: a reload keeps it
    const stored = sessionStorage.getItem('demo-caption');
    if (stored) {
      caption.innerHTML = stored;
      caption.classList.add('shown');
    }
    document.addEventListener(
      'mousemove',
      (event) => {
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY}px`;
      },
      true
    );
    document.addEventListener(
      'mousedown',
      () => cursor.classList.add('down'),
      true
    );
    document.addEventListener(
      'mouseup',
      () => cursor.classList.remove('down'),
      true
    );
  };
  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
};

// The actions that act in the editor, which bring it back first when a site shows
const editorActions = new Set([
  'open',
  'collapse',
  'type',
  'command',
  'language',
  'run',
  'terminal',
  'panel',
  'scroll',
  'reveal'
]);
// The actions after which the terminal still has the keyboard
const keepsTerminal = new Set([
  'run',
  'terminal',
  'caption',
  'hold',
  'wait',
  'card'
]);

// Plays the demo into `out`: Playwright's recording and journey.json, or failed.png when a step fails. `last` is the
// last chapter to play, to review a demo a few chapters at a time; 0 plays the opening cards alone.
export const playJourney = async (
  demo: IDemo,
  out: string,
  last = demo.chapters.length
) => {
  const { environment, files, chapters } = demo;
  const { workspace, viewport, typingDelay } = environment;
  const editorUrl = `http://127.0.0.1:${environment.editor.port}/?folder=${workspace}`;
  // where the mouse goes, as fractions of the screen, measured at 1280 × 720
  const spot = (x: number, y: number) => ({
    x: Math.round(viewport.width * x),
    y: Math.round(viewport.height * y)
  });
  const middle = spot(0.5, 0.5);
  const overText = spot(820 / 1280, 380 / 720);
  const overExplorer = spot(180 / 1280, 400 / 720);
  const overNewFile = spot(800 / 1280, 300 / 720);

  const segments: ISegment[] = [];
  let startedAt = 0;
  // where the kept part of the video begins: after the editor's first visit
  let begin = 0;
  let recapAt: number | undefined;
  const now = () => (Date.now() - startedAt) / 1000;
  // where the visible cursor rests, which a command palette click returns it to
  let mouse = middle;

  // What the journey knows of the page: which one it shows, the File the editor shows, whether the terminal has the
  // keyboard, and the cards waiting to be shown, which fade into each other when nothing comes between them.
  const state = {
    page: 'editor',
    file: '',
    isTerminalFocused: false,
    cards: [] as ICardShow[]
  };

  // A step's URL: <site>:/… on the site's address
  const urlOf = (url: string) => {
    const match = /^([a-z0-9-]+):(?!\/\/)(.*)$/.exec(url);
    return match && match[1] in environment.sites
      ? `${environment.sites[match[1]]}${match[2]}`
      : url;
  };

  // A file of the workspace
  const inWorkspace = (file: IFile) => join(workspace, file.path);

  // Waits until `ready` answers true, at most `timeout` ms; the wait plays `speed` times faster in the video.
  const waitFor = async (
    what: string,
    ready: () => Promise<boolean> | boolean,
    timeout = 120_000,
    speed = 8
  ) => {
    const start = now();
    const deadline = Date.now() + timeout;
    while (!(await ready())) {
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for ${what}`);
      await sleep(500);
    }
    const end = now();
    if (end - start > 2)
      segments.push({ start: start + 1, end: end - 0.5, speed });
  };

  const caption = async (page: Page, title: string, detail = '') => {
    const html = detail
      ? `${escape(title)}<small>${escape(detail)}</small>`
      : escape(title);
    await page.evaluate((text) => {
      sessionStorage.setItem('demo-caption', text);
      const element = document.getElementById('demo-caption');
      if (!element) return;
      element.innerHTML = text;
      element.classList.toggle('shown', text !== '');
    }, html);
  };

  // Moves the visible cursor to an element in a few steps, then clicks it.
  const click = async (page: Page, selector: string | Locator) => {
    const target =
      typeof selector === 'string' ? page.locator(selector) : selector;
    await target.first().waitFor({ state: 'visible', timeout: 30_000 });
    const box = await target.first().boundingBox();
    if (box) {
      mouse = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(mouse.x, mouse.y, { steps: 12 });
    }
    await sleep(200);
    await target.first().click();
  };

  // Scrolls with the wheel until the element's top is near the page's top, as a person would.
  const scrollTo = async (page: Page, target: Locator) => {
    const box = await target.first().boundingBox();
    if (!box) return;
    const distance = box.y - 70;
    for (let step = 0; step < 10; step += 1) {
      await page.mouse.wheel(0, distance / 10);
      await sleep(40);
    }
  };

  // Types one character at a time: insertText leaves the editor's auto-indent out
  const type = async (page: Page, text: string, delay = typingDelay) => {
    for (const char of text) {
      if (char === '\n') await page.keyboard.press('Enter');
      else await page.keyboard.insertText(char);
      await sleep(delay);
    }
  };

  // Cards over the page, each for its seconds: the next one fades in over the one before, so the page shows again
  // only after the last one. The page underneath keeps its state.
  const slides = async (page: Page, cards: ICardShow[]) => {
    for (const { html, seconds, isRecap } of cards) {
      if (isRecap) recapAt = now();
      await page.evaluate(async (srcdoc) => {
        const before = [...document.querySelectorAll('.demo-slide')];
        const frame = document.createElement('iframe');
        document.body.classList.add('demo-slides');
        frame.className = 'demo-slide';
        frame.srcdoc = srcdoc;
        document.body.appendChild(frame);
        await new Promise((resolve) => frame.addEventListener('load', resolve));
        frame.classList.add('shown');
        await new Promise((resolve) => setTimeout(resolve, 450));
        for (const old of before) old.remove();
      }, html);
      await sleep(seconds * 1000);
    }
    await page.evaluate(async () => {
      const frames = [...document.querySelectorAll('.demo-slide')];
      for (const frame of frames) frame.classList.remove('shown');
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (const frame of frames) frame.remove();
      document.body.classList.remove('demo-slides');
    });
  };

  // Shows the cards waiting to be shown, as one sequence.
  const flushCards = async (page: Page) => {
    if (!state.cards.length) return;
    const cards = state.cards;
    state.cards = [];
    await slides(page, cards);
  };

  // Runs a step the viewer needs not see at its pace, as a page's reload, much faster in the video.
  const quickly = async (step: () => Promise<void>) => {
    const start = now();
    await step();
    segments.push({ start, end: now(), speed: 100 });
  };

  // A VS Code command by its title, through the command palette: the row with that exact title is clicked, as the
  // palette may list another first (a recently used one, or one whose words match).
  const command = async (page: Page, title: string) => {
    await page.keyboard.press('F1');
    await page
      .locator('.quick-input-widget input')
      .waitFor({ state: 'visible' });
    await page.keyboard.insertText(title);
    await sleep(500);
    const row = page
      .locator('.quick-input-list .monaco-list-row')
      .filter({
        has: page.locator('.label-name', {
          hasText: new RegExp(
            `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
          )
        })
      })
      .first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      // back where it was: resting on a tab, it would show the file's full path
      await page.mouse.move(mouse.x, mouse.y);
    } else await page.keyboard.press('Enter');
    await sleep(500);
  };

  const openEditor = async (page: Page) => {
    await page.goto(editorUrl);
    await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
    await page
      .locator('.explorer-folders-view .monaco-list-row')
      .first()
      .waitFor({ timeout: 60_000 });
    await sleep(1500);
  };

  // A fresh browser's first visit: trust the folder, and close the walkthrough and the secondary side bar, before the
  // part of the video that the render keeps.
  const firstVisit = async (page: Page) => {
    const trust = page.getByRole('button', {
      name: 'Yes, I trust the authors'
    });
    if (await trust.isVisible().catch(() => false)) await trust.click();
    await sleep(1000);
    await command(page, 'View: Close All Editors');
    if (
      await page
        .locator('.part.auxiliarybar')
        .isVisible()
        .catch(() => false)
    ) {
      await command(page, 'View: Toggle Secondary Side Bar Visibility');
    }
    await page.mouse.move(middle.x, middle.y);
    await sleep(1500);
  };

  // Back to the editor from a site: the editor reloads, which plays fast.
  const backToEditor = async (page: Page) => {
    await quickly(async () => {
      await openEditor(page);
      await page.keyboard.press('Escape');
    });
    state.page = 'editor';
  };

  // Scrolls the editor down by about `lines` lines, slowly, with the mouse over the text.
  const scrollEditor = async (page: Page, lines: number) => {
    await page.mouse.move(overText.x, overText.y, { steps: 8 });
    for (let step = 0; step < lines; step += 1) {
      await page.mouse.wheel(0, 22);
      await sleep(70);
    }
  };

  // Hides the panel, which holds the terminals, then shows it again with the terminal in it: explicit commands, as a
  // toggle would depend on what shows.
  const isPanelShown = (page: Page) =>
    page
      .locator('.part.panel')
      .isVisible()
      .catch(() => false);
  const hidePanel = async (page: Page) => {
    for (const title of ['View: Hide Panel', 'View: Toggle Panel Visibility']) {
      if (!(await isPanelShown(page))) return;
      await command(page, title);
      await sleep(400);
    }
  };
  const showPanel = async (page: Page) => {
    await command(page, 'Terminal: Focus Terminal');
    await page.keyboard.press('Escape');
  };

  // Gives the keyboard to the last terminal, where the journey types its commands; it opens the first one. The first
  // key after a click on a terminal may be dropped: a space, then its removal, takes that place.
  const focusTerminal = async (page: Page) => {
    if (state.isTerminalFocused) return;
    const screens = page.locator('.terminal-wrapper .xterm-screen');
    if ((await screens.count()) === 0) {
      await command(page, 'Terminal: Create New Terminal');
      await screens.first().waitFor();
      await sleep(1500);
    } else {
      await page.keyboard.press('Escape');
      await click(page, screens.last());
      await sleep(1200);
      await page.keyboard.press('Space');
      await sleep(200);
      await page.keyboard.press('Backspace');
    }
    state.isTerminalFocused = true;
  };

  // The Explorer's rendered rows, in their order
  const rows = (page: Page) =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll('.explorer-folders-view .monaco-list-row')
      ].map(
        (row): IRow => ({
          index: Number(row.getAttribute('data-index')),
          level: Number(row.getAttribute('aria-level')),
          name: row.getAttribute('aria-label') ?? '',
          expanded: row.getAttribute('aria-expanded')
        })
      )
    );

  const rowLocator = (page: Page, row: IRow) =>
    page.locator(
      `.explorer-folders-view .monaco-list-row[data-index="${row.index}"]`
    );

  // The Explorer's row of a path of the workspace, its folders expanded on the way. The list draws only the rows in
  // view, so it scrolls when a row is not drawn, and a folder is clicked only to change its state.
  const explorerRow = async (page: Page, path: string) => {
    const parts = path.split('/');
    let parent: IRow | undefined;
    for (const [depth, name] of parts.entries()) {
      let found: IRow | undefined;
      for (let attempt = 0; attempt < 12 && !found; attempt += 1) {
        const drawn = (await rows(page)).sort((a, b) => a.index - b.index);
        const after = parent
          ? drawn.filter((row) => row.index > (parent as IRow).index)
          : drawn;
        const end = after.findIndex((row) => row.level <= depth);
        const inside = end === -1 ? after : after.slice(0, end);
        found = inside.find(
          (row) => row.level === depth + 1 && row.name === name
        );
        if (!found) {
          await page.mouse.move(overExplorer.x, overExplorer.y);
          await page.mouse.wheel(0, attempt < 6 ? 200 : -400);
          await sleep(150);
        }
      }
      if (!found)
        throw new Error(
          `no ${parts.slice(0, depth + 1).join('/')} in the Explorer`
        );
      const isLast = depth === parts.length - 1;
      if (!isLast && found.expanded === 'false') {
        await click(page, rowLocator(page, found));
        await sleep(300);
      }
      parent = found;
    }
    return parent as IRow;
  };

  // Opens a File from the Explorer, then waits for its tab.
  const openFile = async (page: Page, file: IFile) => {
    const row = await explorerRow(page, file.path);
    await click(page, rowLocator(page, row));
    await page
      .getByRole('tab', {
        name: new RegExp(basename(file.path).replace(/\./g, '\\.'))
      })
      .first()
      .waitFor();
    state.file = file.path;
  };

  // Types a File's part, without the terminal under it: a new file, from the Explorer's New File in its folder, or
  // more text at the end of the file. Then saves it once, as a watcher may act on each save.
  const typeFile = async (page: Page, step: IPlayStep) => {
    const file = files[step.type ?? ''];
    await hidePanel(page);
    if (existsSync(inWorkspace(file))) {
      if (state.file !== file.path) await openFile(page, file);
      await command(page, 'Go to Line/Column...');
      const lines = readFileSync(inWorkspace(file), 'utf8').split('\n').length;
      await type(page, String(lines), 60);
      await page.keyboard.press('Enter');
      await sleep(400);
    } else {
      const folder = dirname(file.path);
      if (folder !== '.')
        await click(page, rowLocator(page, await explorerRow(page, folder)));
      await click(page, page.getByRole('button', { name: 'New File...' }));
      await type(page, `${basename(file.path)}\n`, 40);
      await page.mouse.move(overNewFile.x, overNewFile.y, { steps: 10 });
      await page.locator('.monaco-editor.focused').waitFor();
      await sleep(500);
    }
    const typing = now();
    await type(page, step.typing ?? '');
    segments.push({ start: typing + 2, end: now() - 1, speed: 2.5 });
    await sleep(600);
    await page.keyboard.press('ControlOrMeta+s');
    await sleep(500);
    await showPanel(page);
    state.file = file.path;
  };

  // A wait's condition: a URL answers (its JSON meeting `until`, a JavaScript expression of `it`), a File exists in
  // the workspace, or the page shows a text.
  const condition = (page: Page, step: IPlayStep) => {
    if (step.file) {
      const path = inWorkspace(files[step.file]);
      return () => existsSync(path);
    }
    if (step.text) {
      const text = step.text;
      return async () =>
        (await page.getByText(text, { exact: true }).count()) > 0;
    }
    // the manifests are the project's own files, and `until` their author's expression
    const until = step.until
      ? // oxlint-disable-next-line no-implied-eval
        (new Function('it', `return (${step.until});`) as (
          it: unknown
        ) => boolean)
      : undefined;
    return async () => {
      try {
        const res = await fetch(urlOf(step.url ?? ''), {
          method: step.method ?? 'GET',
          headers: step.body
            ? { 'content-type': 'application/json' }
            : undefined,
          body: step.body
        });
        if (!res.ok) return false;
        return until ? Boolean(until(await res.json())) : true;
      } catch {
        return false;
      }
    };
  };

  const play = async (page: Page, step: IPlayStep) => {
    const action = actionOf(step);
    if (action === 'card') {
      const card = demo.cards[step.card ?? ''];
      state.cards.push({
        html: renderCard(card, chapters),
        seconds: card.seconds ?? 6
      });
      return;
    }
    await flushCards(page);
    if (editorActions.has(action) && state.page !== 'editor')
      await backToEditor(page);
    if (!keepsTerminal.has(action)) state.isTerminalFocused = false;
    switch (action) {
      case 'open':
        await openFile(page, files[step.open ?? '']);
        break;
      case 'collapse': {
        const row = await explorerRow(page, step.collapse ?? '');
        if (row.expanded === 'true') await click(page, rowLocator(page, row));
        break;
      }
      case 'type':
        await typeFile(page, step);
        break;
      case 'command':
        await command(page, step.command ?? '');
        break;
      case 'language':
        await command(page, 'Change Language Mode');
        await type(page, step.language ?? '', 40);
        await sleep(500);
        await page.keyboard.press('Enter');
        await sleep(600);
        break;
      case 'run':
        await focusTerminal(page);
        await sleep(500);
        await type(page, step.run ?? '', 35);
        await sleep(300);
        await page.keyboard.press('Enter');
        break;
      case 'terminal':
        await command(page, 'Terminal: Split Terminal');
        state.isTerminalFocused = true;
        break;
      case 'panel':
        if (step.panel === 'hide') await hidePanel(page);
        else await showPanel(page);
        break;
      case 'scroll':
        await scrollEditor(page, Number(step.scroll));
        break;
      case 'reveal': {
        const line =
          readFileSync(join(workspace, state.file), 'utf8')
            .split('\n')
            .findIndex((text) => text.startsWith(step.reveal ?? '')) + 1;
        if (line === 0)
          throw new Error(`no line ${step.reveal} in ${state.file}`);
        await command(page, 'Go to Line/Column...');
        await type(page, String(line), 60);
        await page.keyboard.press('Enter');
        break;
      }
      case 'caption':
        await caption(page, step.caption ?? '', step.detail);
        break;
      case 'page':
        if (step.page === 'editor') {
          if (state.page !== 'editor') await backToEditor(page);
        } else {
          await page.goto(urlOf(step.page ?? ''));
          state.page = step.page ?? '';
        }
        if (step.caption !== undefined)
          await caption(page, step.caption, step.detail);
        if (step.shows) {
          await page
            .getByText(step.shows, { exact: true })
            .first()
            .waitFor({ timeout: 60_000 });
        }
        break;
      case 'scrollTo':
        await scrollTo(
          page,
          page.getByText(step.scrollTo ?? '', { exact: true })
        );
        break;
      case 'pick':
        await click(page, page.getByLabel(step.pick ?? ''));
        await sleep(800);
        await click(
          page,
          page.getByRole('option', { name: String(step.option) })
        );
        break;
      case 'upload': {
        const chooser = page.waitForEvent('filechooser');
        await click(
          page,
          page.getByRole('button', { name: step.upload ?? '' })
        );
        await (await chooser).setFiles(inWorkspace(files[step.file ?? '']));
        break;
      }
      case 'wait':
        await waitFor(
          step.wait ?? 'a condition',
          condition(page, step),
          (step.timeout ?? 120) * 1000,
          step.speed ?? 8
        );
        break;
    }
    if (step.hold) await sleep(step.hold * 1000);
  };

  mkdirSync(out, { recursive: true });
  const { chromium } = playwright(demo.root);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    recordVideo: { dir: out, size: viewport }
  });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  startedAt = Date.now();
  try {
    await openEditor(page);
    await firstVisit(page);
    begin = now();
    state.cards = demo.opening.map((card) => ({
      html: renderCard(card, chapters),
      seconds: card.seconds ?? 8
    }));
    for (const [index, chapter] of chapters.slice(0, last).entries()) {
      state.cards.push({
        html: renderChapter(index, chapters),
        seconds: chapter.cardSeconds ?? 4
      });
      for (const step of chapter.steps) {
        try {
          await play(page, step);
        } catch (error) {
          throw new Error(
            `${step.where} (${actionOf(step)}): ${(error as Error).message}`,
            { cause: error }
          );
        }
      }
    }
    if (last >= chapters.length && demo.recap) {
      state.cards.push({
        html: renderCard(demo.recap, chapters),
        seconds: demo.recap.seconds ?? 9,
        isRecap: true
      });
    }
    await flushCards(page);
  } catch (error) {
    await page
      .screenshot({ path: join(out, 'failed.png') })
      .catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw error;
  }

  const video = page.video();
  await context.close();
  await browser.close();
  const journey: IJourney = {
    video: (await video?.path()) ?? '',
    begin,
    duration: now(),
    segments,
    ...(recapAt === undefined ? {} : { recap: recapAt })
  };
  writeFileSync(
    join(out, 'journey.json'),
    `${JSON.stringify(journey, null, 2)}\n`
  );
  console.log(`recorded ${journey.video}, ${segments.length} sped-up parts`);
};
