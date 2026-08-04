/**
 * Timestamp helpers shared by transcript, chapters and clip modules.
 *
 * Gemini reasons about audio natively in MM:SS, so we ask it for strings and do
 * the conversion to seconds here — deterministically, in code, rather than
 * trusting the model to do arithmetic.
 */

/** Parses "SS", "MM:SS" or "HH:MM:SS" (optionally with decimals) into seconds. */
export function toSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;

  const parts = value.trim().split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return 0;

  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** Formats seconds as MM:SS, or HH:MM:SS when the video is an hour or longer. */
export function toTimestamp(totalSeconds, { forceHours = false } = {}) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0 || forceHours
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Normalises model-supplied segments: converts timestamps, drops empties,
 * sorts, and clamps to the real media duration so a hallucinated end time can
 * never make ffmpeg cut past the end of the file.
 */
export function normalizeSegments(segments, durationSec = Infinity) {
  if (!Array.isArray(segments)) return [];

  return segments
    .map((segment) => {
      const start = Math.min(toSeconds(segment.start), durationSec);
      const rawEnd = toSeconds(segment.end);
      const end = Math.min(rawEnd > start ? rawEnd : start + 2, durationSec);
      return { start, end, text: String(segment.text ?? "").trim() };
    })
    .filter((segment) => segment.text.length > 0 && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
}

/** Renders segments as a timestamped transcript for prompting. */
export function segmentsToPromptText(segments) {
  return segments.map((s) => `[${toTimestamp(s.start)}] ${s.text}`).join("\n");
}
