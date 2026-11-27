// A demo's parts, which the engine renders one by one and then joins: the opening, each chapter from its card, and the
// recap. Each part's file keeps the hash of what it shows, so that merge names a part whose chapter changed since it
// was recorded.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type IDemo, actionOf } from './manifests.ts';
import { renderCard, renderChapter } from './slides.ts';

// The demo's parts, in the order the video shows them
export const partNames = (demo: IDemo) => [
  'opening',
  ...demo.chapters.map((chapter) => chapter.name),
  ...(demo.recap ? ['recap'] : [])
];

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// What a part shows: its cards, its steps with the text that they type, the files that they open as the project holds
// them, and the look of the recording. What the chapters before it leave, as a file typed or a command run, is not
// its own: a change there needs the parts after it recorded again too.
export const partHash = (demo: IDemo, name: string) => {
  const { chapters, environment } = demo;
  const look = {
    viewport: environment.viewport,
    typingDelay: environment.typingDelay,
    addressBar: environment.addressBar,
    settings: environment.editor.settings,
    terminal: demo.terminal
  };
  let shown: unknown;
  if (name === 'opening') {
    shown = demo.opening.map((card) => [
      renderCard(card, chapters),
      card.seconds ?? 8
    ]);
  } else if (name === 'recap') {
    shown = demo.recap
      ? [renderCard(demo.recap, chapters), demo.recap.seconds ?? 9]
      : null;
  } else {
    const index = chapters.findIndex((chapter) => chapter.name === name);
    if (index === -1) {
      throw new Error(
        `no part ${name}: the parts are ${partNames(demo).join(', ')}`
      );
    }
    const chapter = chapters[index];
    const steps = chapter.steps.map(({ where: _, ...step }) => step);
    // the files that its steps open, as the project holds them; a file that the journey writes has no text yet
    const files: Record<string, string | null> = {};
    for (const step of chapter.steps) {
      for (const key of ['open', 'file'] as const) {
        const file = step[key] ? demo.files[step[key]] : undefined;
        if (!file || file.path.includes('*')) continue;
        const path = join(demo.root, file.path);
        files[file.path] =
          existsSync(path) && statSync(path).isFile()
            ? digest(readFileSync(path, 'utf8'))
            : null;
      }
    }
    const cards = chapter.steps
      .filter((step) => actionOf(step) === 'card')
      .map((step) => {
        const card = demo.cards[step.card ?? ''];
        return [renderCard(card, chapters), card.seconds ?? 6];
      });
    shown = {
      card: [renderChapter(index, chapters), chapter.cardSeconds ?? 4],
      steps,
      files,
      cards
    };
  }
  return digest({ look, shown }).slice(0, 16);
};
