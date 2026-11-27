// Renders a journey's recording into the demo's parts, then joins the parts into its video. A part, the opening, a
// chapter from its card, or the recap, is cut from the recording, each sped-up wait played faster, and written as WebM
// (VP9) and MP4 (H.264) with the same settings, so that ffmpeg's concat demuxer joins the parts without encoding them
// again; the poster is the frame shortly before the recap.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IJourney, ISegment } from './journey.ts';
import type { IDemo } from './manifests.ts';
import { partHash, partNames } from './parts.ts';

// A part's file, beside its videos: what it shows, as a hash, and its length
export interface IPartFile {
  part: string;
  hash: string;
  seconds: number;
  recorded: string;
}

const formats = {
  webm: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1'],
  mp4: [
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '26',
    '-pix_fmt',
    'yuv420p'
  ]
};

const checkFfmpeg = () => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error('no ffmpeg on the PATH');
  }
};

// A video's length in seconds
const lengthOf = (path: string) =>
  Number(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        path
      ],
      { encoding: 'utf8' }
    ).trim()
  );

// The pieces of [start, end) in order: normal speed between the waits, each wait at its own
const piecesOf = (segments: ISegment[], start: number, end: number) => {
  const pieces: ISegment[] = [];
  let at = start;
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    if (segment.end <= at || segment.start >= end) continue;
    if (segment.start > at)
      pieces.push({ start: at, end: segment.start, speed: 1 });
    pieces.push({
      start: Math.max(segment.start, at),
      end: Math.min(segment.end, end),
      speed: segment.speed
    });
    at = Math.min(segment.end, end);
  }
  if (at < end) pieces.push({ start: at, end, speed: 1 });
  return pieces;
};

const encode = (
  video: string,
  pieces: ISegment[],
  path: string,
  args: string[]
) => {
  const filters = pieces.map(
    ({ start, end, speed }, index) =>
      `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[p${index}]`
  );
  const graph = `${filters.join(';')};${pieces.map((_, index) => `[p${index}]`).join('')}concat=n=${pieces.length}:v=1:a=0,fps=25[v]`;
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-i',
      video,
      '-filter_complex',
      graph,
      '-map',
      '[v]',
      ...args,
      path
    ],
    { stdio: 'inherit' }
  );
};

// Renders the parts that <from>/journey.json played, or those named, into <to>/parts/: <part>.webm, .mp4 and .json.
export const renderParts = (
  from: string,
  to: string,
  demo: IDemo,
  only?: string[]
) => {
  checkFfmpeg();
  const journey = JSON.parse(
    readFileSync(join(from, 'journey.json'), 'utf8')
  ) as IJourney;
  for (const name of only ?? []) {
    if (!journey.parts.some((mark) => mark.name === name))
      throw new Error(`the journey did not reach the part ${name}`);
  }
  const folder = join(to, 'parts');
  mkdirSync(folder, { recursive: true });
  const rendered: string[] = [];
  journey.parts.forEach((mark, index) => {
    if (only && !only.includes(mark.name)) return;
    const end = journey.parts[index + 1]?.at ?? journey.duration;
    const pieces = piecesOf(journey.segments, mark.at, end);
    const base = join(folder, mark.name);
    encode(journey.video, pieces, `${base}.webm`, formats.webm);
    encode(journey.video, pieces, `${base}.mp4`, formats.mp4);
    const file: IPartFile = {
      part: mark.name,
      hash: partHash(demo, mark.name),
      seconds: lengthOf(`${base}.mp4`),
      recorded: new Date().toISOString()
    };
    writeFileSync(`${base}.json`, `${JSON.stringify(file, null, 2)}\n`);
    rendered.push(mark.name);
  });
  console.log(`rendered ${rendered.join(', ')} into ${folder}`);
  return rendered;
};

// Joins the demo's parts in <to>/parts/, in its order, into <to>/<name>.webm, .mp4 and .png, with no encoding, and
// answers the video's length. A part that is missing, or whose chapter changed since it was recorded, is named.
export const mergeParts = (to: string, demo: IDemo) => {
  checkFfmpeg();
  const folder = join(to, 'parts');
  const problems: string[] = [];
  const parts = partNames(demo).map((name) => {
    const base = join(folder, name);
    if (!['json', 'webm', 'mp4'].every((ext) => existsSync(`${base}.${ext}`))) {
      problems.push(`${name}: no part; record it with --chapters ${name}`);
      return { name, base, seconds: 0 };
    }
    const file = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as IPartFile;
    if (file.hash !== partHash(demo, name)) {
      problems.push(
        `${name}: changed since its part was recorded; record it with --chapters ${name}`
      );
    }
    return { name, base, seconds: file.seconds };
  });
  if (problems.length)
    throw new Error(`not merged:\n  ${problems.join('\n  ')}`);
  const output = (ext: string) => join(to, `${demo.name}.${ext}`);
  for (const ext of ['webm', 'mp4'] as const) {
    const list = join(tmpdir(), `demo-concat-${process.pid}-${ext}.txt`);
    writeFileSync(
      list,
      parts
        .map((part) => `file '${`${part.base}.${ext}`.replace(/'/g, "'\\''")}'`)
        .join('\n') + '\n'
    );
    try {
      execFileSync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          list,
          '-c',
          'copy',
          ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []),
          output(ext)
        ],
        { stdio: 'inherit' }
      );
    } finally {
      rmSync(list, { force: true });
    }
  }
  const beforeRecap = parts
    .filter((part) => part.name !== 'recap')
    .reduce((sum, part) => sum + part.seconds, 0);
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-ss',
      Math.max(0, beforeRecap - 1.5).toFixed(3),
      '-i',
      output('mp4'),
      '-frames:v',
      '1',
      output('png')
    ],
    { stdio: 'inherit' }
  );
  const total = parts.reduce((sum, part) => sum + part.seconds, 0);
  const seconds = lengthOf(output('mp4'));
  console.log(
    `merged ${parts.length} parts into ${to}: ${demo.name}.webm, ${demo.name}.mp4, ${demo.name}.png, ${seconds.toFixed(1)} s (its parts: ${total.toFixed(1)} s)`
  );
  return seconds;
};
