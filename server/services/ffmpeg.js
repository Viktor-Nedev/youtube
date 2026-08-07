import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

/**
 * Thin wrapper over the bundled ffmpeg/ffprobe binaries.
 *
 * We call the binaries directly instead of using fluent-ffmpeg: that package was
 * archived in May 2025 and no longer works with current ffmpeg builds. Direct
 * execFile also means no shell quoting bugs on Windows paths with spaces.
 */

const execFileAsync = promisify(execFile);
const ffprobePath = ffprobeStatic.path;

// Video work is slow; give it real headroom but never hang forever.
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 32 * 1024 * 1024;

async function run(binary, args, { timeout = DEFAULT_TIMEOUT_MS, cwd } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      cwd
    });
    return { stdout, stderr };
  } catch (error) {
    // ffmpeg puts the useful diagnostics on stderr; surface its tail, not a bare exit code.
    const detail = String(error.stderr || error.message || "").trim().split("\n").slice(-6).join("\n");
    throw new Error(`ffmpeg failed (${path.basename(binary)}): ${detail}`);
  }
}

export async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Escapes a filename for use *inside* a filter argument (subtitles=, movie=…).
 *
 * Only ever given a bare filename, never a full path. Filter options are
 * colon-separated and the value passes through two parsers — the filtergraph
 * and then the filter itself — so a Windows drive letter needs `\\:` to
 * survive both. Rather than rely on that, `cutClip` runs ffmpeg with its
 * working directory set to the subtitle file's folder so no drive letter ever
 * reaches the filter string.
 */
export function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\\\:").replace(/'/g, "\\'");
}

/** Media metadata: duration in seconds, dimensions, whether an audio track exists. */
export async function probe(inputPath) {
  const { stdout } = await run(ffprobePath, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    inputPath
  ], { timeout: 60_000 });

  const info = JSON.parse(stdout);
  const video = info.streams.find((s) => s.codec_type === "video");
  const audio = info.streams.find((s) => s.codec_type === "audio");

  return {
    durationSec: Number(info.format?.duration ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video)
  };
}

/**
 * Extracts a mono 16kHz MP3 for transcription.
 * Gemini bills audio at 32 tokens/second regardless of bitrate, so we optimise
 * purely for a small upload: mono, 16kHz, 48kbps.
 */
export async function extractAudio(inputPath, outputPath) {
  await ensureDir(path.dirname(outputPath));
  await run(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-b:a", "48k",
    outputPath
  ]);
  return outputPath;
}

/**
 * Extracts just one span of audio, for per-clip word timing.
 * Short audio gives markedly better word timestamps than asking a model to
 * locate words inside a long recording.
 */
export async function extractAudioSegment(inputPath, startSec, endSec, outputPath) {
  await ensureDir(path.dirname(outputPath));
  await run(ffmpegPath, [
    "-y",
    "-ss", String(startSec),
    "-t", String(Math.max(0.5, endSec - startSec)),
    "-i", inputPath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-b:a", "48k",
    outputPath
  ], { timeout: 120_000 });
  return outputPath;
}

/**
 * Samples one frame every `everySec` seconds.
 * Returns frames with their source timestamp so downstream modules can map a
 * chosen thumbnail back to a moment in the video.
 */
export async function extractFrames(inputPath, outputDir, { everySec = 2, maxWidth = 1280 } = {}) {
  await ensureDir(outputDir);
  const pattern = path.join(outputDir, "frame_%04d.jpg");

  await run(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-vf", `fps=1/${everySec},scale=${maxWidth}:-2:flags=lanczos`,
    "-q:v", "3",
    pattern
  ]);

  const files = (await fs.promises.readdir(outputDir))
    .filter((f) => /^frame_\d+\.jpg$/.test(f))
    .sort();

  // fps=1/N emits its first frame at t=0, so index i maps to t = i * everySec.
  return files.map((file, index) => ({
    file: path.join(outputDir, file),
    name: file,
    timeSec: index * everySec
  }));
}

/** Grabs a single frame at an exact timestamp (used for high-res thumbnail rendering). */
export async function extractFrameAt(inputPath, timeSec, outputPath) {
  await ensureDir(path.dirname(outputPath));
  await run(ffmpegPath, [
    "-y",
    "-ss", String(timeSec),
    "-i", inputPath,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath
  ], { timeout: 120_000 });
  return outputPath;
}

/**
 * Cuts a segment, reframed to 9:16 for Shorts, with burned-in ASS captions,
 * colour-emoji overlays and optional motion effects.
 *
 * Captions are an ASS file rendered by libass rather than image overlays: at
 * one word per cue a 30-second clip needs ~100 cues, which as PNG inputs would
 * be unworkable, and ASS gives timing, styling and animation natively.
 *
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {number} options.startSec
 * @param {number} options.endSec
 * @param {boolean} [options.vertical]           Reframe to 1080x1920
 * @param {"crop"|"pad"} [options.fit]           How to reach 9:16 — see below
 * @param {string} [options.assFile]             Absolute path to a subtitle file
 * @param {Array<{file:string,startSec:number,endSec:number,y:number}>} [options.overlays]
 * @param {{zoom?:boolean,punchIn?:boolean,fadeEdges?:boolean}} [options.effects]
 */
export async function cutClip({
  input,
  output,
  startSec,
  endSec,
  vertical = true,
  fit = "crop",
  assFile = null,
  overlays = [],
  effects = {}
}) {
  await ensureDir(path.dirname(output));
  const duration = Math.max(0.5, endSec - startSec);

  const args = ["-y", "-ss", String(startSec), "-t", String(duration), "-i", input];
  for (const overlay of overlays) args.push("-i", overlay.file);

  /**
   * Two ways to reach 9:16:
   *
   * "crop" centre-crops and fills the frame — right for a person on camera,
   * who sits in the middle third anyway.
   *
   * "pad" fits the whole frame over a blurred, zoomed copy of itself. Blind
   * centre-cropping a 1920-wide screen recording keeps only ~600px of the
   * middle, which slices a webpage or slide into something unreadable; padding
   * keeps all the content and fills the empty thirds instead of black bars.
   */
  const VERTICAL_CROP = "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920:flags=lanczos,setsar=1";

  // The backdrop is blurred at a quarter size and scaled back up. Blurring at
  // full 1080x1920 was the single most expensive filter in the chain, and since
  // the result is a heavy blur anyway the downscale is invisible.
  const VERTICAL_PAD =
    "split=2[bg][fg];" +
    "[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=8,eq=brightness=-0.12," +
    "scale=1080:1920:flags=bilinear[blurred];" +
    "[fg]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fitted];" +
    "[blurred][fitted]overlay=(W-w)/2:(H-h)/2,setsar=1";

  const baseFilter = vertical
    ? fit === "pad"
      ? VERTICAL_PAD
      : VERTICAL_CROP
    : "scale=1280:-2:flags=lanczos,setsar=1";

  /**
   * Motion effects, applied before captions so the text stays rock-steady
   * while the picture moves underneath it.
   *
   * zoompan is avoided deliberately — it re-times output to its own fps and
   * desynchronises audio. A scale-then-crop pair driven by `t` gives the same
   * slow push without touching the frame rate.
   */
  const motion = [];
  if (effects.zoom) {
    const scale = vertical ? "1080*(1+0.06*t/DUR)" : "1280*(1+0.06*t/DUR)";
    motion.push(
      `scale=w='${scale.replace(/DUR/g, duration.toFixed(2))}':h=-2:eval=frame`,
      vertical ? "crop=1080:1920" : "crop=1280:ih"
    );
  }
  if (effects.punchIn) {
    // Brief tighter framing over the hook, then release.
    const hold = Math.min(1.6, duration * 0.25).toFixed(2);
    motion.push(
      `scale=w='if(lt(t,${hold}),${vertical ? 1080 : 1280}*1.12,${vertical ? 1080 : 1280})':h=-2:eval=frame`,
      vertical ? "crop=1080:1920" : "crop=1280:ih"
    );
  }
  if (effects.fadeEdges) {
    motion.push(`fade=t=in:st=0:d=0.35`, `fade=t=out:st=${Math.max(0, duration - 0.35).toFixed(2)}:d=0.35`);
  }

  const steps = [`[0:v]${baseFilter}${motion.length ? "," + motion.join(",") : ""}[base]`];
  let current = "base";

  overlays.forEach((overlay, index) => {
    const next = `ov${index}`;
    // Overlay timings are relative to the clip, not the source video.
    const from = Math.max(0, overlay.startSec - startSec);
    const to = Math.max(from, overlay.endSec - startSec);
    const y = overlay.y ?? "H-h-160";
    steps.push(
      `[${current}][${index + 1}:v]overlay=(W-w)/2:${y}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'[${next}]`
    );
    current = next;
  });

  // Captions last so nothing scales or crops the text. Referenced by bare
  // filename with ffmpeg's cwd set below — see escapeFilterPath.
  if (assFile) {
    const next = "subbed";
    steps.push(`[${current}]subtitles=${escapeFilterPath(path.basename(assFile))}[${next}]`);
    current = next;
  }

  args.push(
    "-filter_complex", steps.join(";"),
    "-map", `[${current}]`,
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    output
  );

  // cwd is the subtitle's folder so the filter can reference it by bare name,
  // which keeps the Windows drive letter out of the filter string entirely.
  await run(ffmpegPath, args, { cwd: assFile ? path.dirname(assFile) : undefined });
  return output;
}

/** Renders a frame sequence from a source video, for the landing-page scroll scrub. */
export async function extractScrubFrames(inputPath, outputDir, { count = 120, width = 1600 } = {}) {
  await ensureDir(outputDir);
  const { durationSec } = await probe(inputPath);
  const fps = count / Math.max(durationSec, 0.1);

  await run(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-vf", `fps=${fps.toFixed(4)},scale=${width}:-2:flags=lanczos`,
    "-q:v", "4",
    path.join(outputDir, "scrub_%04d.jpg")
  ]);

  return (await fs.promises.readdir(outputDir)).filter((f) => f.startsWith("scrub_")).sort();
}

export { ffmpegPath, ffprobePath };
