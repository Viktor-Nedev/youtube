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

async function run(binary, args, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout,
      maxBuffer: MAX_BUFFER,
      windowsHide: true
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
 * Cuts a segment, optionally reframed to 9:16 vertical for Shorts and optionally
 * with pre-rendered caption PNGs burned in.
 *
 * Caption overlays are PNGs (rendered by sharp) rather than ffmpeg's drawtext:
 * drawtext needs a libfreetype-enabled build plus painful Windows font-path
 * escaping, and PNG overlays give us full typographic control for free.
 *
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {number} options.startSec
 * @param {number} options.endSec
 * @param {boolean} [options.vertical]     Reframe to 1080x1920
 * @param {"crop"|"pad"} [options.fit]     How to reach 9:16 — see below
 * @param {Array<{file: string, startSec: number, endSec: number}>} [options.overlays]
 */
export async function cutClip({
  input,
  output,
  startSec,
  endSec,
  vertical = true,
  fit = "crop",
  overlays = []
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
  const VERTICAL_PAD =
    "split=2[bg][fg];" +
    "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28,eq=brightness=-0.12[blurred];" +
    "[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fitted];" +
    "[blurred][fitted]overlay=(W-w)/2:(H-h)/2,setsar=1";

  const baseFilter = vertical
    ? fit === "pad"
      ? VERTICAL_PAD
      : VERTICAL_CROP
    : "scale=1280:-2:flags=lanczos,setsar=1";

  const steps = [`[0:v]${baseFilter}[base]`];
  let current = "base";

  overlays.forEach((overlay, index) => {
    const next = `ov${index}`;
    // Overlay timings are relative to the clip, not the source video.
    const from = Math.max(0, overlay.startSec - startSec);
    const to = Math.max(from, overlay.endSec - startSec);
    steps.push(
      `[${current}][${index + 1}:v]overlay=(W-w)/2:H-h-160:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'[${next}]`
    );
    current = next;
  });

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

  await run(ffmpegPath, args);
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
