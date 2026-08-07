import express from "express";
import path from "node:path";
import { extractFrames, extractFrameAt } from "../services/ffmpeg.js";
import { rankFrames } from "../services/frameScore.js";
import { renderThumbnail, makePreview } from "../services/thumbnail.js";
import { generateJSON, imagePart, MODELS } from "../services/gemini.js";
import { fingerprintToPromptContext } from "../services/fingerprint.js";
import { requireProject, updateProject, projectDir, toPublicUrl, getActiveFingerprint } from "../store.js";
import { toTimestamp } from "../utils/time.js";

const router = express.Router();

const VISION_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      description: "One entry per candidate image, in the order they were provided",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "1-based index of the image as provided" },
          score: { type: "integer", description: "Click appeal from 1 to 10" },
          reasoning: { type: "string", description: "One sentence on why it scores that way" },
          hasFace: { type: "boolean" },
          expression: {
            type: "string",
            description: "Facial expression if a face is present, otherwise 'none'"
          }
        },
        required: ["index", "score", "reasoning", "hasFace", "expression"]
      }
    },
    winnerIndex: { type: "integer", description: "1-based index of the best thumbnail frame" },
    overlayText: { type: "string", description: "Punchy overlay text, 5 words maximum" },
    textPosition: { type: "string", enum: ["left", "right", "center"] },
    accentColor: { type: "string", description: "Hex colour for the text, e.g. #FFE01A" },
    winnerReason: { type: "string", description: "Why this frame wins over the others" },
    alternates: {
      type: "array",
      description:
        "Two further thumbnail directions that are genuinely different from the winner and from each other — a different frame, a different angle of text, or a different colour treatment",
      items: {
        type: "object",
        properties: {
          frameIndex: { type: "integer", description: "1-based index of the frame to use" },
          overlayText: { type: "string", description: "Overlay text, 5 words maximum" },
          textPosition: { type: "string", enum: ["left", "right", "center"] },
          accentColor: { type: "string", description: "Hex colour" },
          angle: { type: "string", description: "Short label for the hook, e.g. 'question', 'result-first'" }
        },
        required: ["frameIndex", "overlayText", "textPosition", "accentColor", "angle"]
      }
    }
  },
  required: [
    "candidates",
    "winnerIndex",
    "overlayText",
    "textPosition",
    "accentColor",
    "winnerReason",
    "alternates"
  ]
};

/**
 * Finalists are cached between the two-phase calls below.
 *
 * Deliberately in memory rather than on the project: they hold absolute frame
 * paths that have no business reaching the browser, and they are cheap to
 * rebuild if the process restarts mid-flow.
 *
 * @type {Map<string, {finalists: Array, framesSampled: number, elapsedMs: number}>}
 */
const finalistCache = new Map();

/**
 * Phase 1 — sample frames and score them locally. No AI, no cost.
 * Split out so the candidate grid can appear after ~15s instead of the browser
 * sitting on a blank spinner for the full ~70s round trip.
 */
async function buildCandidates(project) {
  const dir = projectDir(project.id);
  const started = Date.now();

  // Sample density scales with length so a 2-minute and a 40-minute video both
  // yield a workable number of candidates.
  const duration = project.media.durationSec || 60;
  const everySec = Math.max(1, Math.round(duration / 60));

  const frames = await extractFrames(project.videoPath, path.join(dir, "frames"), { everySec });
  if (!frames.length) {
    throw Object.assign(new Error("Could not extract any frames from this video."), { status: 400 });
  }

  const finalists = await rankFrames(frames, { take: 8 });

  const previews = [];
  for (const [index, frame] of finalists.entries()) {
    const previewPath = path.join(dir, "previews", path.basename(frame.file));
    await makePreview(frame.file, previewPath);
    previews.push({
      index: index + 1,
      timeSec: frame.timeSec,
      timeLabel: toTimestamp(frame.timeSec),
      previewUrl: toPublicUrl(previewPath),
      localScore: frame.score,
      metrics: frame.metrics
    });
  }

  const payload = { finalists, framesSampled: frames.length, elapsedMs: Date.now() - started };
  finalistCache.set(project.id, payload);

  return { ...payload, previews };
}

/** Phase 2 — one multimodal call ranks the finalists and writes the overlay. */
async function judgeCandidates(project, cached) {
  const dir = projectDir(project.id);
  const started = Date.now();
  const finalists = cached.finalists;

  const fingerprint = await getActiveFingerprint();
  const channelContext = fingerprintToPromptContext(fingerprint);

  const prompt = `You are choosing a YouTube thumbnail. ${finalists.length} candidate frames from one video follow, in order.

${channelContext ? `${channelContext}\n\nMatch the overlay text and styling to this channel's established look.\n` : ""}
VIDEO SUMMARY: ${project.transcript?.summary ?? "(not transcribed)"}

For each frame, score click appeal 1-10 judging: facial expression and emotional energy,
composition and subject clarity, whether it still reads at 210x118px on a crowded homepage,
and colour contrast.

Then pick the winner and write overlay text of at most 5 words. The text must add
information the image alone doesn't convey — never just restate what is visible.

Choose textPosition as the side of the winning frame that is emptiest. It must avoid
covering the main subject AND any text already present in the frame — headlines,
slides, captions, browser or app UI. Two competing sets of words in one thumbnail
makes both unreadable, which matters especially for screen recordings and slides.
Pick an accent colour with strong contrast against that region of that frame.

Then give two alternates the creator can choose between. They must be genuinely
different bets, not restatements of the winner — a different frame, a different hook
angle, or a different colour treatment. Three near-identical options are useless.`;

  const imageParts = [];
  for (const frame of finalists) imageParts.push(await imagePart(frame.file));

  const vision = await generateJSON({
    input: [{ type: "text", text: prompt }, ...imageParts],
    schema: VISION_SCHEMA,
    model: MODELS.flash,
    label: "thumbnail:vision"
  });

  // Clamp: a hallucinated index would otherwise crash the render.
  const winnerIndex = Math.min(Math.max(1, vision.winnerIndex), finalists.length) - 1;
  const winner = finalists[winnerIndex];

  // Re-grab the winning moment at full resolution — the ranked frames were
  // downscaled to 1280px for cheap scoring.
  const hiResPath = path.join(dir, "thumbs", `winner-${winner.timeSec}.jpg`);
  await extractFrameAt(project.videoPath, winner.timeSec, hiResPath);

  const finalPath = path.join(dir, "thumbs", "thumbnail.png");
  await renderThumbnail({
    frameFile: hiResPath,
    text: vision.overlayText,
    outputPath: finalPath,
    position: vision.textPosition,
    accent: vision.accentColor
  });

  // Also render a clean version so the creator can add their own text.
  const cleanPath = path.join(dir, "thumbs", "thumbnail-clean.png");
  await renderThumbnail({ frameFile: hiResPath, text: null, outputPath: cleanPath });

  /**
   * Alternates give the creator something to choose between. Each may sit on a
   * different frame, so its source is pulled at full resolution too rather than
   * reusing the winner's.
   */
  const variants = [
    {
      label: "Winner",
      angle: vision.winnerReason,
      overlayText: vision.overlayText,
      textPosition: vision.textPosition,
      accentColor: vision.accentColor,
      timeSec: winner.timeSec,
      url: toPublicUrl(finalPath),
      isWinner: true
    }
  ];

  for (const [index, alt] of (vision.alternates ?? []).entries()) {
    try {
      const altFrame = finalists[Math.min(Math.max(1, alt.frameIndex), finalists.length) - 1];
      const altHiRes = path.join(dir, "thumbs", `alt-src-${altFrame.timeSec}.jpg`);
      await extractFrameAt(project.videoPath, altFrame.timeSec, altHiRes);

      const altPath = path.join(dir, "thumbs", `variant-${index + 1}.png`);
      await renderThumbnail({
        frameFile: altHiRes,
        text: alt.overlayText,
        outputPath: altPath,
        position: alt.textPosition,
        accent: alt.accentColor
      });

      variants.push({
        label: alt.angle,
        angle: alt.angle,
        overlayText: alt.overlayText,
        textPosition: alt.textPosition,
        accentColor: alt.accentColor,
        timeSec: altFrame.timeSec,
        url: toPublicUrl(altPath),
        isWinner: false
      });
    } catch (error) {
      console.warn(`[thumbnail] variant ${index + 1} failed: ${error.message}`);
    }
  }

  const scoreByIndex = new Map(vision.candidates.map((c) => [c.index, c]));
  const candidates = [];

  for (const [index, frame] of finalists.entries()) {
    const previewPath = path.join(dir, "previews", path.basename(frame.file));
    await makePreview(frame.file, previewPath);
    const ai = scoreByIndex.get(index + 1);

    candidates.push({
      index: index + 1,
      timeSec: frame.timeSec,
      timeLabel: toTimestamp(frame.timeSec),
      previewUrl: toPublicUrl(previewPath),
      localScore: frame.score,
      metrics: frame.metrics,
      aiScore: ai?.score ?? null,
      reasoning: ai?.reasoning ?? null,
      hasFace: ai?.hasFace ?? null,
      expression: ai?.expression ?? null,
      isWinner: index === winnerIndex
    });
  }

  const thumbnail = {
    candidates,
    variants,
    framesSampled: cached.framesSampled,
    finalistCount: finalists.length,
    overlayText: vision.overlayText,
    textPosition: vision.textPosition,
    accentColor: vision.accentColor,
    winnerReason: vision.winnerReason,
    winnerTimeSec: winner.timeSec,
    thumbnailUrl: toPublicUrl(finalPath),
    cleanUrl: toPublicUrl(cleanPath),
    usedFingerprint: Boolean(fingerprint),
    // Total across both phases, so the reported time still reflects the real work.
    elapsedMs: cached.elapsedMs + (Date.now() - started)
  };

  updateProject(project.id, { thumbnail });
  return thumbnail;
}

/**
 * POST /api/thumbnail/:projectId/frames — phase 1.
 * Returns the locally scored candidate grid before any AI runs.
 */
router.post("/:projectId/frames", async (req, res, next) => {
  try {
    const project = requireProject(req.params.projectId);
    const { previews, framesSampled, elapsedMs } = await buildCandidates(project);
    res.json({ candidates: previews, framesSampled, finalistCount: previews.length, elapsedMs });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/thumbnail/:projectId/judge — phase 2.
 * Re-runs phase 1 transparently if the cache is cold (e.g. server restarted
 * between the two calls), so the endpoint is safe to call on its own.
 */
router.post("/:projectId/judge", async (req, res, next) => {
  try {
    const project = requireProject(req.params.projectId);
    const cached = finalistCache.get(project.id) ?? (await buildCandidates(project));
    const thumbnail = await judgeCandidates(project, cached);
    res.json({ thumbnail });
  } catch (error) {
    next(error);
  }
});

/** POST /api/thumbnail/:projectId — both phases in one call. */
router.post("/:projectId", async (req, res, next) => {
  try {
    const project = requireProject(req.params.projectId);
    const cached = await buildCandidates(project);
    const thumbnail = await judgeCandidates(project, cached);
    res.json({ thumbnail });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/thumbnail/:projectId/render — re-render with custom text.
 * Lets the creator iterate on wording without paying for another vision call.
 */
router.post("/:projectId/render", async (req, res, next) => {
  try {
    const project = requireProject(req.params.projectId);
    if (!project.thumbnail) {
      throw Object.assign(new Error("Generate a thumbnail first."), { status: 400 });
    }

    const { text, position = "left", accent = "#FFE01A", timeSec } = req.body ?? {};
    const dir = projectDir(project.id);
    const sourceTime = timeSec ?? project.thumbnail.winnerTimeSec;

    const framePath = path.join(dir, "thumbs", `winner-${sourceTime}.jpg`);
    await extractFrameAt(project.videoPath, sourceTime, framePath);

    // Unique filename so the browser doesn't serve a cached older render.
    const outputPath = path.join(dir, "thumbs", `thumbnail-${Date.now()}.png`);
    await renderThumbnail({ frameFile: framePath, text, outputPath, position, accent });

    const thumbnailUrl = toPublicUrl(outputPath);
    updateProject(project.id, {
      thumbnail: { ...project.thumbnail, thumbnailUrl, overlayText: text, textPosition: position, accentColor: accent }
    });

    res.json({ thumbnailUrl });
  } catch (error) {
    next(error);
  }
});

export default router;
