// A demo's cards (references/manifests.md#card): each one full screen, at the recording's size, which the journey lays
// over the page and `demo cards` saves as images.
//
// A card's text takes two marks: **bold** and `code`. Anything else is shown as written.

interface ICardBase {
  kicker: string;
  title: string;
  // how long the journey shows it
  seconds?: number;
}

// A heading and paragraphs, as the card that states the goal and the scenario.
export interface ITextCard extends ICardBase {
  layout: 'text';
  paragraphs: string[];
}

// A heading and a list, with an optional line under it.
export interface IListCard extends ICardBase {
  layout: 'list';
  items: string[];
  footer?: string;
}

// The table of contents: the chapters' titles and details, numbered.
export interface IContentsCard extends ICardBase {
  layout: 'contents';
}

// A folder's tree, whose lines that start with `#` after the tree's lines are comments; `compact` for a long one.
export interface ITreeCard extends ICardBase {
  layout: 'tree';
  tree: string;
  compact?: boolean;
}

export type CardType = ITextCard | IListCard | IContentsCard | ITreeCard;

export const layouts = ['text', 'list', 'contents', 'tree'];

// A chapter as its card and the table of contents name it.
export interface IChapterTitle {
  title: string;
  detail: string;
}

// A file of a tree drawn from Files: its path under the tree's root, and the comment above it.
export interface ITreeEntry {
  path: string;
  comment?: string;
}

interface INode {
  name: string;
  comment?: string;
  children: INode[];
}

// A tree drawn from Files: the root, then its files in the order given, each folder listed where its first file is, and a
// comment line above each file that has one.
export const treeOfFiles = (root: string, entries: ITreeEntry[]) => {
  const top: INode = { name: root, children: [] };
  for (const { path, comment } of entries) {
    let node = top;
    for (const name of path.split('/')) {
      let child = node.children.find((each) => each.name === name);
      if (!child) {
        child = { name, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.comment = comment;
  }
  const lines = [`${root === '' ? '.' : root}/`];
  const walk = (node: INode, prefix: string) => {
    node.children.forEach((child, index) => {
      const isLast = index === node.children.length - 1;
      const isFolder = child.children.length > 0;
      if (child.comment) lines.push(`${prefix}│ # ${child.comment}`);
      lines.push(
        `${prefix}${isLast ? '└── ' : '├── '}${child.name}${isFolder ? '/' : ''}`
      );
      if (isFolder) walk(child, `${prefix}${isLast ? '    ' : '│   '}`);
    });
  };
  walk(top, '');
  return `${lines.join('\n')}\n`;
};

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A card's text: escaped, then **bold** and `code`.
const inline = (text: string) =>
  escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

// A tree's line: its comment, after the tree's lines and spaces, in the comments' color.
const treeLine = (line: string) =>
  escape(line).replace(/^([\s│├└─]*)(# .*)$/, '$1<span class="note">$2</span>');

const page = (body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; color: #eef0f6;
    background: radial-gradient(circle at 20% 15%, #2b2350 0%, #14131f 55%, #0d0d14 100%);
    font: 400 22px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  main { width: 1040px; }
  .kicker { color: #a99bff; font-size: 17px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
  h1 { margin: 10px 0 22px; font-size: 46px; line-height: 1.15; font-weight: 700; }
  h1.small { font-size: 36px; }
  p { margin: 0 0 14px; color: #c9cbe0; }
  ul, ol { margin: 0; padding: 0; list-style: none; }
  li { margin: 0 0 12px; padding-left: 30px; position: relative; color: #dfe1f0; }
  ul li::before { content: ''; position: absolute; left: 6px; top: 12px; width: 9px; height: 9px; border-radius: 50%;
    background: #7c6cf2; }
  ol { counter-reset: item; display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: column;
    grid-template-rows: repeat(3, auto); column-gap: 40px; }
  ol li { counter-increment: item; padding-left: 54px; margin-bottom: 20px; break-inside: avoid; }
  ol li::before { content: counter(item); position: absolute; left: 0; top: -2px; width: 38px; height: 38px;
    border-radius: 10px; background: #2f2a55; color: #c7bdff; font-weight: 700; text-align: center;
    line-height: 38px; }
  ol li small { display: block; color: #9a9db5; font-size: 17px; }
  b { color: #fff; font-weight: 600; }
  code { font: 500 0.92em ui-monospace, SFMono-Regular, Menlo, monospace; color: #c7bdff; }
  pre { margin: 0; padding: 22px 26px; border-radius: 14px; background: rgba(0, 0, 0, 0.35);
    font: 400 17px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; color: #e6e7f2; }
  pre .note { color: #8f93ad; }
  pre.compact { font-size: 12.5px; line-height: 1.3; padding: 14px 22px; }
  h1.small + pre.compact { margin-top: -6px; }
  .chapter { display: flex; gap: 34px; align-items: center; }
  .number { flex: none; width: 120px; height: 120px; border-radius: 28px; background: #2f2a55; color: #c7bdff;
    font-size: 64px; font-weight: 700; text-align: center; line-height: 120px; }
</style></head><body><main>${body}</main></body></html>`;

const heading = (card: CardType) =>
  `<div class="kicker">${inline(card.kicker)}</div>
<h1${card.layout === 'text' ? '' : ' class="small"'}>${inline(card.title)}</h1>`;

const body = (card: CardType, chapters: IChapterTitle[]) => {
  switch (card.layout) {
    case 'text':
      return card.paragraphs.map((text) => `<p>${inline(text)}</p>`).join('\n');
    case 'list': {
      const items = card.items
        .map((item) => `<li>${inline(item)}</li>`)
        .join('');
      const footer = card.footer
        ? `\n<p style="margin-top: 22px">${inline(card.footer)}</p>`
        : '';
      return `<ul>${items}</ul>${footer}`;
    }
    case 'contents':
      return `<ol>${chapters
        .map(
          ({ title, detail }) =>
            `<li><b>${inline(title)}</b><small>${inline(detail)}</small></li>`
        )
        .join('')}</ol>`;
    case 'tree': {
      const lines = card.tree.trimEnd().split('\n').map(treeLine).join('\n');
      return `<pre${card.compact ? ' class="compact"' : ''}>${lines}</pre>`;
    }
  }
};

export const renderCard = (card: CardType, chapters: IChapterTitle[]) =>
  page(`${heading(card)}\n${body(card, chapters)}`);

// The card that opens a chapter: its number, its title and what it covers.
export const renderChapter = (index: number, chapters: IChapterTitle[]) => {
  const { title, detail } = chapters[index];
  return page(`<div class="chapter"><div class="number">${index + 1}</div><div>
<div class="kicker">Step ${index + 1} of ${chapters.length}</div>
<h1>${inline(title)}</h1>
<p>${inline(detail)}</p></div></div>`);
};
