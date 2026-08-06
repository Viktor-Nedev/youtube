import express from "express";
import path from "node:path";
import { cutClip } from "../services/ffmpeg.js";
import { renderCaptionStrip } from "../services/thumbnail.js";
import { generateJSON, MODELS } from "../services/gemini.js";
import { fingerprintToPromptContext } from "../services/fingerprint.js";
import { requireProject, updateProject, projectDir, toPublicUrl, getActiveFingerprint } from "../store.js";
import { segmentsToPromptText, toSeconds, toTimestamp } from "../utils/time.js";

const router = express.Router();

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
          caption: { type: "string", description: "Caption for posting, including 2-3 hashtags" }
        },
        required: ["start", "end", "title", "reason", "hook", "caption"]
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

    const { withCaptions = true, vertical = true, fit = "crop" } = req.body ?? {};
    const started = Date.now();
    const duration = project.media.durationSec;

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
These cut real video, so an invented timestamp produces a broken clip.`;

    const result = await generateJSON({
      input: prompt,
      schema: CLIPS_SCHEMA,
      model: MODELS.flash,
      label: "clips"
    });

    const dir = projectDir(project.id);
    const clips = [];

    for (const [index, proposal] of (result.clips ?? []).entries()) {
      // Clamp everything to reality before it reaches ffmpeg.
      let start = Math.max(0, toSeconds(proposal.start));
      let end = Math.min(toSeconds(proposal.end), duration);

      if (end - start < MIN_CLIP_SEC) end = Math.min(start + MIN_CLIP_SEC, duration);
      if (end - start > MAX_CLIP_SEC) end = start + MAX_CLIP_SEC;
      if (end <= start || start >= duration) {
        console.warn(`[clips] skipping "${proposal.title}" — unusable range ${proposal.start}-${proposal.end}`);
        continue;
      }

      // Burn in only the transcript segments this clip actually covers.
      const overlays = [];
      if (withCaptions) {
        const covered = project.transcript.segments.filter((s) => s.end > start && s.start < end);
        for (const [segmentIndex, segment] of covered.entries()) {
          const stripPath = path.join(dir, "captions", `clip${index}-${segmentIndex}.png`);
          await renderCaptionStrip({ text: segment.text, outputPath: stripPath });
          overlays.push({
            file: stripPath,
            startSec: Math.max(segment.start, start),
            endSec: Math.min(segment.end, end)
          });
        }
      }

      const outputPath = path.join(dir, "clips", `clip-${index + 1}.mp4`);
      await cutClip({
        input: project.videoPath,
        output: outputPath,
        startSec: start,
        endSec: end,
        vertical,
        fit,
        overlays
      });

      clips.push({
        index: index + 1,
        title: proposal.title,
        reason: proposal.reason,
        hook: proposal.hook,
        caption: proposal.caption,
        startSec: start,
        endSec: end,
        durationSec: Number((end - start).toFixed(1)),
        startLabel: toTimestamp(start),
        endLabel: toTimestamp(end),
        captionCount: overlays.length,
        url: toPublicUrl(outputPath)
      });
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
      withCaptions,
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
