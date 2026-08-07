import path from "node:path";
import fs from "node:fs";
import { extractAudioSegment } from "./ffmpeg.js";
import { generateJSON, audioPart, MODELS } from "./gemini.js";
import { toSeconds } from "../utils/time.js";

/**
 * Word-level timings for short-form captions.
 *
 * Short-form captions show one or two words at a time, which needs timing an
 * order of magnitude finer than the 5-15 second segments the main transcript
 * produces. Asking the model to locate every word across a whole video is
 * unreliable, so each clip's audio is sliced out and timed on its own.
 *
 * There is always a deterministic fallback: a bad or empty model response
 * degrades to proportional spacing rather than breaking caption rendering.
 */

const WORD_SCHEMA = {
  type: "object",
  properties: {
    words: {
      type: "array",
      description: "Every spoken word in order, with its start and end time",
      items: {
        type: "object",
        properties: {
          word: { type: "string", description: "The single word, no surrounding punctuation" },
          start: { type: "string", description: "Start time as MM:SS.cc relative to this audio clip" },
          end: { type: "string", description: "End time as MM:SS.cc relative to this audio clip" }
        },
        required: ["word", "start", "end"]
      }
    }
  },
  required: ["words"]
};

/**
 * Spreads a phrase's words across its span, weighted by word length.
 *
 * Used when the model is unavailable or returns nothing usable. Longer words
 * take proportionally longer to say, so character-weighting tracks speech
 * noticeably better than dividing the span evenly.
 */
export function distributeWords(segments, startSec, endSec) {
  const words = [];

  for (const segment of segments) {
    const from = Math.max(segment.start, startSec);
    const to = Math.min(segment.end, endSec);
    if (to <= from) continue;

    const tokens = String(segment.text).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) || 1;
    let cursor = from;

    for (const token of tokens) {
      const share = (token.length / totalChars) * (to - from);
      words.push({ word: token, start: cursor, end: cursor + share });
      cursor += share;
    }
  }

  return words;
}

/** Clamps and repairs model timings so they can never produce invalid cues. */
function normalizeWords(rawWords, clipDuration) {
  const words = [];

  for (const item of rawWords ?? []) {
    const word = String(item.word ?? "").trim();
    if (!word) continue;

    let start = Math.max(0, toSeconds(item.start));
    let end = toSeconds(item.end);

    if (!(end > start)) end = start + 0.28;
    start = Math.min(start, clipDuration);
    end = Math.min(end, clipDuration);
    if (end <= start) continue;

    words.push({ word, start, end });
  }

  words.sort((a, b) => a.start - b.start);

  // Overlapping cues make captions flicker; trim each to its successor.
  for (let i = 0; i < words.length - 1; i += 1) {
    if (words[i].end > words[i + 1].start) words[i].end = words[i + 1].start;
  }

  return words.filter((w) => w.end > w.start);
}

/**
 * Returns word timings **relative to the clip**, i.e. the first word of the
 * clip starts near 0 regardless of where the clip sits in the source video.
 *
 * @param {object} options
 * @param {string} options.videoPath
 * @param {string} options.workDir      Where to put the extracted audio slice
 * @param {number} options.startSec     Clip start in the source video
 * @param {number} options.endSec       Clip end in the source video
 * @param {Array}  options.segments     Transcript segments, for the fallback
 * @param {boolean} [options.useModel]  Set false to force the deterministic path
 */
export async function getWordTimings({
  videoPath,
  workDir,
  startSec,
  endSec,
  segments = [],
  useModel = true
}) {
  const duration = Math.max(0.5, endSec - startSec);

  // Fallback is computed first so it is always available, and rebased to the clip.
  const fallback = distributeWords(segments, startSec, endSec).map((w) => ({
    word: w.word,
    start: Math.max(0, w.start - startSec),
    end: Math.min(duration, w.end - startSec)
  }));

  if (!useModel) return { words: fallback, source: "estimated" };

  try {
    const audioPath = path.join(workDir, `wordtiming-${Math.round(startSec)}.mp3`);
    await extractAudioSegment(videoPath, startSec, endSec, audioPath);

    const result = await generateJSON({
      model: MODELS.flash,
      label: "wordTiming",
      input: [
        {
          type: "text",
          text: `Transcribe this ${duration.toFixed(1)}-second audio clip word by word.

Return every spoken word in order with the time it starts and ends, as MM:SS.cc
relative to the start of THIS clip (the first word begins near 00:00.00).

These timings drive on-screen captions that show one word at a time, so they must
track the speech closely — a word whose timing drifts appears over the wrong audio.
Do not merge words, do not add punctuation as separate entries, and do not skip
filler words.`
        },
        await audioPart(audioPath)
      ],
      schema: WORD_SCHEMA
    });

    const words = normalizeWords(result.words, duration);

    // A response covering far less speech than the fallback means the model
    // dropped most of the clip; the estimate is better than a sparse result.
    if (words.length >= Math.max(3, fallback.length * 0.5)) {
      fs.promises.unlink(audioPath).catch(() => {});
      return { words, source: "model" };
    }

    console.warn(`[wordTiming] model returned ${words.length} words vs ${fallback.length} expected — using estimate`);
  } catch (error) {
    console.warn(`[wordTiming] falling back to estimate: ${error.message}`);
  }

  return { words: fallback, source: "estimated" };
}

/**
 * Groups words into caption cues of one or two words.
 * Two-word cues are only formed when both words are short, so a cue never
 * grows wider than the safe caption area.
 */
export function groupWords(words, wordsPerCue = 1) {
  if (wordsPerCue <= 1) return words.map((w) => ({ ...w, text: w.word }));

  const cues = [];
  for (let i = 0; i < words.length; ) {
    const first = words[i];
    const second = words[i + 1];
    const fitsTogether = second && first.word.length + second.word.length <= 14;

    if (fitsTogether) {
      cues.push({
        text: `${first.word} ${second.word}`,
        word: `${first.word} ${second.word}`,
        start: first.start,
        end: second.end
      });
      i += 2;
    } else {
      cues.push({ ...first, text: first.word });
      i += 1;
    }
  }
  return cues;
}
