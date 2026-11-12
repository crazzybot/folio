// Encodes record.mjs's frames into demo.mp4 and its poster, in the same
// folder:
//
//   node encode.mjs out
//
// Each frame lasts until the next one was captured. Stalls over 5 s (the
// page waiting on nothing) are cut to 1.6 s, and the last frame (the Marks
// view) is held 1.5 s. The poster is the Send dialog's Text tab, about 11 s
// before the end: demo-poster.png, then demo-poster.webp if cwebp is
// installed (`brew install webp`).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ffmpeg from "ffmpeg-static";

const dir = resolve(process.argv[2] ?? "out");
const frames = JSON.parse(readFileSync(`${dir}/frames.json`, "utf8"));
const STALL = 5;
const STALL_CUT = 1.6;
const HOLD_LAST = 1.5;
const POSTER_BEFORE_END = 11;

const durations = frames.map((f, i) => {
  const next = frames[i + 1];
  if (!next) return HOLD_LAST;
  const gap = next.t - f.t;
  return gap > STALL ? STALL_CUT : gap;
});
let list = "ffconcat version 1.0\n";
frames.forEach((f, i) => {
  list += `file '${dir}/${f.file}'\nduration ${durations[i].toFixed(4)}\n`;
});
// The concat demuxer ignores the last entry's duration unless the file repeats
list += `file '${dir}/${frames.at(-1).file}'\n`;
writeFileSync(`${dir}/list.txt`, list);

const total = durations.reduce((a, b) => a + b, 0);
console.log(`${frames.length} frames, ${total.toFixed(1)} s`);

execFileSync(ffmpeg, [
  "-y", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", `${dir}/list.txt`,
  "-vf", "fps=30,format=yuv420p", "-an",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "stillimage",
  "-movflags", "+faststart",
  `${dir}/demo.mp4`,
], { stdio: "inherit" });

const at = Math.max(0, total - POSTER_BEFORE_END);
execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", at.toFixed(2), "-i", `${dir}/demo.mp4`, "-frames:v", "1", `${dir}/demo-poster.png`], { stdio: "inherit" });
try {
  execFileSync("cwebp", ["-quiet", "-q", "82", `${dir}/demo-poster.png`, "-o", `${dir}/demo-poster.webp`]);
} catch {
  console.warn("cwebp not found: convert demo-poster.png yourself (brew install webp)");
}
console.log(`wrote demo.mp4 and the poster (at ${at.toFixed(1)} s) to ${dir}`);
