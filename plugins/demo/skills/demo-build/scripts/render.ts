// Renders a journey's recording into the demo's video: the editor's first visit cut, each sped-up wait played faster,
// written as WebM (VP9) and MP4 (H.264) with ffmpeg, and a poster, the frame shortly before the recap card.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IJourney, ISegment } from './journey.ts';

// Renders <from>/journey.json into <to>/<name>.webm, .mp4 and .png, and answers the video's length in seconds.
export const renderVideo = (from: string, to: string, name: string) => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error('no ffmpeg on the PATH');
  }
  const journey = JSON.parse(
    readFileSync(join(from, 'journey.json'), 'utf8')
  ) as IJourney;

  // The parts in order: normal speed between the waits, each wait at its speed
  const parts: ISegment[] = [];
  let at = journey.begin;
  for (const segment of [...journey.segments].sort(
    (a, b) => a.start - b.start
  )) {
    if (segment.end <= at) continue;
    if (segment.start > at)
      parts.push({ start: at, end: segment.start, speed: 1 });
    parts.push({
      start: Math.max(segment.start, at),
      end: segment.end,
      speed: segment.speed
    });
    at = segment.end;
  }
  parts.push({ start: at, end: journey.duration, speed: 1 });

  // A moment of the recording, in the video
  const inVideo = (moment: number) =>
    parts.reduce(
      (sum, { start, end, speed }) =>
        sum + Math.max(0, Math.min(end, moment) - start) / speed,
      0
    );

  const filters = parts.map(
    ({ start, end, speed }, index) =>
      `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[p${index}]`
  );
  const graph = `${filters.join(';')};${parts.map((_, index) => `[p${index}]`).join('')}concat=n=${parts.length}:v=1:a=0,fps=25[v]`;
  const ffmpeg = (args: string[]) =>
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        journey.video,
        '-filter_complex',
        graph,
        '-map',
        '[v]',
        ...args
      ],
      { stdio: 'inherit' }
    );
  ffmpeg([
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '36',
    '-row-mt',
    '1',
    join(to, `${name}.webm`)
  ]);
  ffmpeg([
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '26',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    join(to, `${name}.mp4`)
  ]);
  const seconds = inVideo(journey.duration);
  const poster = Math.max(0, inVideo(journey.recap ?? journey.duration) - 1.5);
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-ss',
      poster.toFixed(3),
      '-i',
      join(to, `${name}.mp4`),
      '-frames:v',
      '1',
      join(to, `${name}.png`)
    ],
    { stdio: 'inherit' }
  );
  console.log(
    `rendered ${parts.length} parts, ${seconds.toFixed(0)} s, into ${to}: ${name}.webm, ${name}.mp4, ${name}.png`
  );
  return seconds;
};
