import path from "node:path";
import { extractFrameAt } from "./ffmpeg.js";
import { generateJSON, imagePart, MODELS } from "./gemini.js";

/**
 * Works out what kind of footage a project holds, so Shorts framing can be
 * chosen automatically.
 *
 * This exists because the framing decision is not one a creator should have to
 * reason about. Centre-cropping to 9:16 is right for a person on camera and
 * destructive for a screen recording — it keeps ~600px out of a 1920px-wide
 * frame, slicing a slide or a webpage into something unreadable. Rather than
 * leave a toggle the user has to know to flip, the source is inspected once and
 * the sensible default is picked for them.
 */

const SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["camera", "screen", "mixed"],
      description:
        "camera = filmed footage such as a person talking; screen = screen or slide recording; mixed = both, e.g. a webcam inset over a screen share"
    },
    subjectCentred: {
      type: "boolean",
      description: "True when the main subject sits in the middle third and survives a centre crop"
    },
    reason: { type: "string", description: "One short sentence of justification" }
  },
  required: ["type", "subjectCentred", "reason"]
};

/**
 * Samples three frames across the video and classifies them in one lite call.
 *
 * @returns {{type: string, subjectCentred: boolean, reason: string, fit: "crop"|"pad"}}
 */
export async function detectContentType(project, workDir) {
  const duration = project.media?.durationSec || 60;
  // Avoid the very start and end, which are often titles or black frames.
  const offsets = [0.25, 0.5, 0.75].map((f) => Math.max(1, duration * f));

  const parts = [];
  for (const [index, at] of offsets.entries()) {
    const framePath = path.join(workDir, `probe-${index}.jpg`);
    await extractFrameAt(project.videoPath, at, framePath);
    parts.push(await imagePart(framePath));
  }

  const result = await generateJSON({
    model: MODELS.lite,
    label: "contentType",
    schema: SCHEMA,
    input: [
      {
        type: "text",
        text: `Three frames sampled from one video. Classify the footage.

Say "screen" for a screen or slide recording — browser windows, application UI, code,
presentation slides, a desktop. Say "camera" for filmed footage such as a person talking
to camera. Say "mixed" when both are present at once, like a webcam inset over a screen share.

subjectCentred should be true only when the important content sits within the middle third
horizontally and would survive being cropped to a tall 9:16 frame.`
      },
      ...parts
    ]
  });

  // A centred filmed subject is the only case where cropping gains anything.
  const fit = result.type === "camera" && result.subjectCentred ? "crop" : "pad";
  return { ...result, fit };
}
