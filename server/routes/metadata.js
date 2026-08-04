import express from "express";
import { generateJSON, MODELS } from "../services/gemini.js";
import { fingerprintToPromptContext } from "../services/fingerprint.js";
import { requireProject, updateProject, getActiveFingerprint } from "../store.js";
import { segmentsToPromptText, toTimestamp, toSeconds } from "../utils/time.js";

const router = express.Router();

const METADATA_SCHEMA = {
  type: "object",
  properties: {
    titles: {
      type: "array",
      description: "Exactly 5 alternative titles, strongest first",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The title, under 100 characters" },
          rationale: {
            type: "string",
            description:
              "One sentence tying this title to a specific channel pattern or, if no channel data, to a general CTR principle"
          },
          angle: {
            type: "string",
            description: "Short label for the hook used, e.g. 'question', 'curiosity gap', 'listicle'"
          }
        },
        required: ["text", "rationale", "angle"]
      }
    },
    description: {
      type: "string",
      description: "200-300 word YouTube description: hook paragraph, what viewers learn, natural keywords"
    },
    tags: {
      type: "array",
      description: "15-20 tags, mixing broad and specific search terms",
      items: { type: "string" }
    },
    chapters: {
      type: "array",
      description: "Chapters at real topic changes. The first MUST start at 00:00 or YouTube rejects them.",
      items: {
        type: "object",
        properties: {
          timestamp: { type: "string", description: "MM:SS or HH:MM:SS" },
          label: { type: "string", description: "Short chapter label, under 40 characters" }
        },
        required: ["timestamp", "label"]
      }
    },
    pinnedComment: {
      type: "string",
      description: "A short pinned comment to drive engagement, in the channel's voice"
    }
  },
  required: ["titles", "description", "tags", "chapters", "pinnedComment"]
};

/** POST /api/metadata/:projectId — generate titles, description, tags, chapters. */
router.post("/:projectId", async (req, res, next) => {
  try {
    const project = requireProject(req.params.projectId);
    if (!project.transcript?.segments?.length) {
      throw Object.assign(new Error("This project has no transcript yet."), { status: 400 });
    }

    const fingerprint = await getActiveFingerprint();
    const channelContext = fingerprintToPromptContext(fingerprint);
    const durationLabel = toTimestamp(project.media.durationSec);

    const prompt = `You are a YouTube SEO strategist writing metadata for a video that is about to be published.

${
  channelContext
    ? `${channelContext}

Use the fingerprint above as your primary guide. The creator's own performance data
outranks generic SEO best practice: if their audience responds to a pattern, use it,
and say so in each title's rationale.`
    : `No channel data is connected, so apply general YouTube CTR best practice and say so in the rationales.`
}

VIDEO LENGTH: ${durationLabel}
LANGUAGE: ${project.transcript.language}
SUMMARY: ${project.transcript.summary}

FULL TRANSCRIPT WITH TIMESTAMPS:
${segmentsToPromptText(project.transcript.segments)}

Rules:
- Titles must be honest about the content. A title the video doesn't deliver on costs
  the channel more in watch time than it gains in clicks.
- Chapters must mark real topic changes in the transcript, not fixed intervals.
  The first chapter starts at 00:00. Never place a chapter past ${durationLabel}.
- Write the description in the video's own language (${project.transcript.language}).`;

    const started = Date.now();
    const result = await generateJSON({
      input: prompt,
      schema: METADATA_SCHEMA,
      model: MODELS.flash,
      label: "metadata"
    });

    // Guard the model's timestamps against the real duration: a chapter past the
    // end of the video makes YouTube reject the whole chapter list.
    const chapters = (result.chapters ?? [])
      .map((chapter) => ({ ...chapter, seconds: toSeconds(chapter.timestamp) }))
      .filter((chapter) => chapter.seconds < project.media.durationSec)
      .sort((a, b) => a.seconds - b.seconds)
      .map((chapter, index) => ({
        // YouTube only honours a chapter list whose first entry is 00:00.
        timestamp: index === 0 ? "0:00" : toTimestamp(chapter.seconds),
        seconds: index === 0 ? 0 : chapter.seconds,
        label: chapter.label
      }));

    const metadata = {
      ...result,
      titles: result.titles.map((t) => ({ ...t, charCount: t.text.length })),
      chapters,
      usedFingerprint: Boolean(fingerprint),
      channelTitle: fingerprint?.channel?.title ?? null,
      elapsedMs: Date.now() - started
    };

    updateProject(project.id, { metadata });
    res.json({ metadata });
  } catch (error) {
    next(error);
  }
});

export default router;
