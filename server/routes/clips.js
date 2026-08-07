import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cutClip } from "../services/ffmpeg.js";
import { generateJSON, MODELS } from "../services/gemini.js";
import { fingerprintToPromptContext } from "../services/fingerprint.js";
import { getWordTimings, groupWords } from "../services/wordTiming.js";
import {
  buildAssFile,
  emojiOverlays,
  SUBTITLE_STYLES,
  SUBTITLE_POSITIONS,
  SUBTITLE_ANIMATIONS
} from "../services/subtitles.js";
import { detectContentType } from "../services/contentType.js";
import { requireProject, updateProject, projectDir, toPublicUrl, getActiveFingerprint } from "../store.js";
import { segmentsToPromptText, toSeconds, toTimestamp } from "../utils/time.js";

const router = express.Router();

const here = path.dirname(fileURLToPath(import.meta.url));
const EMOJI_DIR = path.join(here, "..", "..", "public", "emoji");

/**
 * Emoji the model may choose from.
 *
 * Restricted to a bundled set because libass renders emoji as monochrome
 * glyphs — it does not rasterise colour font layers — so colour emoji are
 * composited as Twemoji PNGs instead. The model can only pick what we ship.
 */
const EMOJI_PALETTE = {
  "🔥": "1f525", "💯": "1f4af", "🚀": "1f680", "😂": "1f602", "😱": "1f631",
  "🤯": "1f92f", "👀": "1f440", "💡": "1f4a1", "⚡": "26a1", "✅": "2705",
  "❌": "274c", "⚠️": "26a0", "🎯": "1f3af", "💰": "1f4b0", "📈": "1f4c8",
  "📉": "1f4c9", "🏆": "1f3c6", "👍": "1f44d", "👎": "1f44e", "❤️": "2764",
  "🤔": "1f914", "😍": "1f60d", "🙌": "1f64c", "👏": "1f44f", "🎬": "1f3ac",
  "📱": "1f4f1", "💻": "1f4bb", "🎥": "1f3a5", "⏰": "23f0", "🔑": "1f511",
  "🧠": "1f9e0", "😮": "1f62e", "🥇": "1f947", "✨": "2728", "🔊": "1f50a", "🎉": "1f389"
};

const CLIPS_SCHEMA = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      description: "3-5 self-contained moments that work as standalone Shorts",
      items: {
        type: "object",
        properties: {
          start: { type: "string", description: "Start timestamp MM:SS or HH:MM:SS" },
          end: { type: "string", description: "End timestamp MM:SS or HH:MM:SS" },
          title: { type: "string", description: "Short title for the clip, under 60 characters" },
          reason: { type: "string", description: "Why this moment works as a standalone Short" },
          hook: { type: "string", description: "The opening line that makes someone stop scrolling" },
          caption: { type: "string", description: "Caption for posting, including 2-3 hashtags" },
          emoji: {
            type: "string",
            description: `A single emoji matching the clip's mood, chosen ONLY from: ${Object.keys(EMOJI_PALETTE).join(" ")}`
          }
        },
        required: ["start", "end", "title", "reason", "hook", "caption", "emoji"]
      }
    }
  },
  required: ["clips"]
};

// YouTube Shorts hard-caps at 60s; below ~15s a clip rarely lands.
const MIN_CLIP_SEC = 15;
const MAX_CLIP_SEC = 60;

/** POST /api/clips/:projectId — find highlight moments and cut them into vertical Shorts. */
router.post("/:projectId", async (req, res, next) => {
  try {
    const project = requireProject(req.params.projectId);
    if (!project.transcript?.segments?.length) {
      throw Object.assign(new Error("This project has no transcript yet."), { status: 400 });
    }

    const {
      withCaptions = true,
      vertical = true,
      fit: requestedFit,
      subtitleStyle = "pop",
      subtitlePosition = "bottom",
      subtitleAnimation = "pop",
      wordsPerCue = 1,
      accent = "#FFE01A",
      withEmoji = true,
      effects = { zoom: true, punchIn: false, fadeEdges: true },
      preciseTiming = true
    } = req.body ?? {};

    // Reject unknown values rather than silently rendering something else.
    const style = SUBTITLE_STYLES.includes(subtitleStyle) ? subtitleStyle : "pop";
    const position = SUBTITLE_POSITIONS.includes(subtitlePosition) ? subtitlePosition : "bottom";
    const animation = SUBTITLE_ANIMATIONS.includes(subtitleAnimation) ? subtitleAnimation : "pop";

    const started = Date.now();
    const duration = project.media.durationSec;
    const dir = projectDir(project.id);

    // Framing: inspect the footage once and cache it, unless explicitly overridden.
    let contentType = project.contentType;
    if (!contentType) {
      try {
        contentType = await detectContentType(project, path.join(dir, "probe"));
        updateProject(project.id, { contentType });
      } catch (error) {
        console.warn(`[clips] content detection failed, defaulting to pad: ${error.message}`);
        contentType = { type: "unknown", fit: "pad", reason: "detection unavailable" };
      }
    }
    const fit = requestedFit ?? contentType.fit ?? "pad";

    const fingerprint = await getActiveFingerprint();
    const channelContext = fingerprintToPromptContext(fingerprint);

    const prompt = `You are a short-form editor pulling Shorts out of a long video.

${channelContext ? `${channelContext}\n\nPick moments that match what this channel's audience already responds to.\n` : ""}
VIDEO LENGTH: ${toTimestamp(duration)}
SUMMARY: ${project.transcript.summary}

TRANSCRIPT:
${segmentsToPromptText(project.transcript.segments)}

Find 3-5 moments that work as standalone Shorts. Each must:
- Run between ${MIN_CLIP_SEC} and ${MAX_CLIP_SEC} seconds.
- Make complete sense to someone who has not seen the full video.
- Open on a hook — a surprising claim, a strong opinion, a question, or a payoff.
- Start and end on sentence boundaries from the transcript, never mid-sentence.

Timestamps must come from the transcript above and must not exceed ${toTimestamp(duration)}.
These cut real video, so an invented timestamp produces a broken clip.

Pick the emoji strictly from the listed set — anything else cannot be rendered.`;

    const result = await generateJSON({
      input: prompt,
      schema: CLIPS_SCHEMA,
      model: MODELS.flash,
      label: "clips"
    });

    // Clamp every proposal to reality before any of it reaches ffmpeg.
    const planned = [];
    for (const [index, proposal] of (result.clips ?? []).entries()) {
      let start = Math.max(0, toSeconds(proposal.start));
      let end = Math.min(toSeconds(proposal.end), duration);

      if (end - start < MIN_CLIP_SEC) end = Math.min(start + MIN_CLIP_SEC, duration);
      if (end - start > MAX_CLIP_SEC) end = start + MAX_CLIP_SEC;
      if (end <= start || start >= duration) {
        console.warn(`[clips] skipping "${proposal.title}" — unusable range ${proposal.start}-${proposal.end}`);
        continue;
      }
      planned.push({ index, proposal, start, end });
    }

    /**
     * Each clip is independent, so they are built concurrently.
     *
     * Sequentially this was over five minutes for four clips: every clip waited
     * on its own word-timing round trip and then its own encode. Both are the
     * slow parts and neither depends on the others.
     */
    const buildClip = async ({ index, proposal, start, end }) => {
      let assFile = null;
      let timingSource = null;
      let wordCount = 0;

      if (withCaptions) {
        const timing = await getWordTimings({
          videoPath: project.videoPath,
          workDir: path.join(dir, "audio"),
          startSec: start,
          endSec: end,
          segments: project.transcript.segments,
          useModel: preciseTiming
        });

        timingSource = timing.source;
        wordCount = timing.words.length;

        if (timing.words.length) {
          assFile = await buildAssFile({
            words: timing.words,
            cues: groupWords(timing.words, Number(wordsPerCue) || 1),
            outputPath: path.join(dir, "subs", `clip-${index + 1}.ass`),
            style,
            position,
            animation,
            accent
          });
        }
      }

      // Colour emoji ride above the caption as a separate overlay.
      const overlays = [];
      const codepoint = EMOJI_PALETTE[proposal.emoji];
      if (withEmoji && codepoint) {
        overlays.push(
          ...emojiOverlays(
            [{ codepoint, startSec: start, endSec: Math.min(start + 2.5, end), start, end }],
            position
          ).map((o) => ({
            file: path.join(EMOJI_DIR, `${o.codepoint}.png`),
            startSec: o.startSec,
            endSec: o.endSec,
            y: o.y
          }))
        );
      }

      const outputPath = path.join(dir, "clips", `clip-${index + 1}.mp4`);
      await cutClip({
        input: project.videoPath,
        output: outputPath,
        startSec: start,
        endSec: end,
        vertical,
        fit,
        assFile,
        overlays,
        effects
      });

      return {
        index: index + 1,
        title: proposal.title,
        reason: proposal.reason,
        hook: proposal.hook,
        caption: proposal.caption,
        emoji: codepoint ? proposal.emoji : null,
        startSec: start,
        endSec: end,
        durationSec: Number((end - start).toFixed(1)),
        startLabel: toTimestamp(start),
        endLabel: toTimestamp(end),
        wordCount,
        timingSource,
        url: `${toPublicUrl(outputPath)}?v=${Date.now()}`
      };
    };

    const settled = await Promise.allSettled(planned.map(buildClip));
    const clips = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);

    for (const failure of settled.filter((s) => s.status === "rejected")) {
      console.warn(`[clips] one clip failed: ${failure.reason?.message}`);
    }

    if (!clips.length) {
      throw Object.assign(
        new Error("No usable clip ranges were produced. The video may be too short for Shorts."),
        { status: 422 }
      );
    }

    const payload = {
      clips,
      vertical,
      fit,
      contentType,
      withCaptions,
      subtitleStyle: style,
      subtitlePosition: position,
      subtitleAnimation: animation,
      wordsPerCue: Number(wordsPerCue) || 1,
      accent,
      withEmoji,
      effects,
      usedFingerprint: Boolean(fingerprint),
      sourceDurationSec: duration,
      elapsedMs: Date.now() - started
    };

    updateProject(project.id, { clips: payload });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

export default router;
