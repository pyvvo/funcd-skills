// A demo's cards as images, to review them before anything is recorded: one PNG per card, in the order the video
// shows them, and cards.png, all of them on one sheet. A card whose content overflows the screen is named.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { playwright } from './journey.ts';
import { type IDemo, actionOf } from './manifests.ts';
import { renderCard, renderChapter } from './slides.ts';

// Renders the cards into `out`, and answers the names of those that overflow the screen.
export const renderCards = async (demo: IDemo, out: string) => {
  const { chapters } = demo;
  const { viewport } = demo.environment;
  // Every card, in the order the video shows it
  const cards: [string, string][] = [
    ...demo.opening.map((card, index): [string, string] => [
      `opening-${index + 1}`,
      renderCard(card, chapters)
    ]),
    ...chapters.flatMap((chapter, index): [string, string][] => [
      [`chapter-${index + 1}`, renderChapter(index, chapters)],
      ...chapter.steps
        .filter((step) => actionOf(step) === 'card')
        .map((step): [string, string] => [
          `card-${step.card}`,
          renderCard(demo.cards[step.card ?? ''], chapters)
        ])
    ]),
    ...(demo.recap
      ? [['recap', renderCard(demo.recap, chapters)] as [string, string]]
      : [])
  ];

  mkdirSync(out, { recursive: true });
  const { chromium } = playwright(demo.root);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  const overflowing: string[] = [];
  for (const [name, html] of cards) {
    await page.setContent(html);
    // content past the screen's edges, or a line wider than its box
    const overflows = await page.evaluate(() => {
      const main = document.querySelector('main')?.getBoundingClientRect();
      const outside =
        !!main &&
        (main.top < 0 || main.bottom > window.innerHeight || main.left < 0);
      const wide = [...document.querySelectorAll('h1, p, li, pre')].some(
        (element) => element.scrollWidth > element.clientWidth + 1
      );
      return outside || wide;
    });
    if (overflows) overflowing.push(name);
    await page.screenshot({ path: join(out, `${name}.png`) });
  }

  // One sheet: the cards two by two, at half their size, each with its name
  const tiles = cards
    .map(
      ([name]) =>
        `<figure><img src="data:image/png;base64,${readFileSync(join(out, `${name}.png`)).toString('base64')}">` +
        `<figcaption>${name}</figcaption></figure>`
    )
    .join('');
  await page.setViewportSize({
    width: viewport.width + 24,
    height: viewport.height
  });
  await page.setContent(`<!doctype html><html><head><style>
  body { margin: 8px; background: #222; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    font: 13px sans-serif; color: #ccc; }
  figure { margin: 0; } img { width: 100%; display: block; } figcaption { padding: 2px 0 4px; }
</style></head><body>${tiles}</body></html>`);
  await page.screenshot({ path: join(out, 'cards.png'), fullPage: true });
  await browser.close();
  writeFileSync(
    join(out, 'cards.txt'),
    `${cards.map(([name]) => name).join('\n')}\n`
  );
  console.log(`${cards.length} cards in ${out}, cards.png on one sheet`);
  return overflowing;
};
