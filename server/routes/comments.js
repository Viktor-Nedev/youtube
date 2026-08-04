import express from "express";
import { getComments, parseVideoId } from "../services/youtube.js";
import { generateJSON, MODELS } from "../services/gemini.js";
import { fingerprintToPromptContext } from "../services/fingerprint.js";
import { getActiveFingerprint } from "../store.js";

const router = express.Router();

export const CATEGORIES = ["spam", "toxic", "genuine_question", "positive_feedback", "criticism", "other"];

const MODERATION_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "1-based index of the comment as numbered in the input" },
          category: { type: "string", enum: CATEGORIES },
          confidence: { type: "number", description: "0 to 1" },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "How urgently the creator should personally respond"
          },
          suggestedReply: {
            type: "string",
            description: "Reply in the creator's voice for questions and criticism; empty string otherwise"
          }
        },
        required: ["index", "category", "confidence", "priority", "suggestedReply"]
      }
    },
    summary: {
      type: "string",
      description: "2-3 sentences on the overall mood and what the creator should address"
    }
  },
  required: ["results", "summary"]
};

// Batched so one video's comments cost one Gemini call, not fifty.
const BATCH_SIZE = 50;

/**
 * POST /api/comments/moderate
 * Body: { video: "<url|id>", limit?: number }
 */
router.post("/moderate", async (req, res, next) => {
  try {
    const { video, limit = 50 } = req.body ?? {};
    const videoId = parseVideoId(video);
    const started = Date.now();

    const comments = await getComments(videoId, Math.min(Number(limit) || 50, 100));
    if (!comments.length) {
      return res.json({ videoId, comments: [], summary: "This video has no comments to moderate.", elapsedMs: 0 });
    }

    const fingerprint = await getActiveFingerprint();
    const channelContext = fingerprintToPromptContext(fingerprint);

    const moderated = [];
    let summary = "";

    for (let offset = 0; offset < comments.length; offset += BATCH_SIZE) {
      const batch = comments.slice(offset, offset + BATCH_SIZE);

      const prompt = `You are triaging YouTube comments for a creator.

${channelContext ? `${channelContext}\n\nWrite suggested replies in this channel's voice.\n` : ""}
Classify each comment:
- spam: scams, self-promotion, bot content, link farming
- toxic: harassment, hate, personal attacks
- genuine_question: the viewer is actually asking something
- positive_feedback: praise or appreciation
- criticism: negative but legitimate feedback worth hearing
- other: anything else

Write a suggestedReply ONLY for genuine_question and criticism. Keep it under 200
characters, friendly, specific, and never defensive. Leave suggestedReply as an empty
string for every other category.

Set priority high when the comment needs the creator personally (a real question, or
fair criticism that deserves acknowledgement).

COMMENTS:
${batch.map((c, i) => `${i + 1}. [${c.likes} likes] ${c.author}: ${c.text.slice(0, 600)}`).join("\n")}`;

      const result = await generateJSON({
        input: prompt,
        schema: MODERATION_SCHEMA,
        // Classification is high-volume and easy; the lite model keeps it fast and cheap.
        model: MODELS.lite,
        label: "comments:moderate"
      });

      const byIndex = new Map(result.results.map((r) => [r.index, r]));
      batch.forEach((comment, index) => {
        const verdict = byIndex.get(index + 1);
        moderated.push({
          ...comment,
          category: verdict?.category ?? "other",
          confidence: verdict?.confidence ?? 0,
          priority: verdict?.priority ?? "low",
          suggestedReply: verdict?.suggestedReply || null
        });
      });

      if (!summary) summary = result.summary;
    }

    const counts = CATEGORIES.reduce((acc, category) => {
      acc[category] = moderated.filter((c) => c.category === category).length;
      return acc;
    }, {});

    res.json({
      videoId,
      summary,
      counts,
      total: moderated.length,
      needsAttention: moderated.filter((c) => c.priority === "high").length,
      comments: moderated,
      usedFingerprint: Boolean(fingerprint),
      elapsedMs: Date.now() - started
    });
  } catch (error) {
    next(error);
  }
});

export default router;
