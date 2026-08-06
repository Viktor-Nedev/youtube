import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { probe, extractAudio } from "../services/ffmpeg.js";
import { generateJSON, audioPart, MODELS } from "../services/gemini.js";
import { normalizeSegments, toTimestamp } from "../utils/time.js";
import {
  newProjectId,
  projectDir,
  createProject,
  requireProject,
  updateProject,
  listProjects,
  toPublicUrl
} from "../store.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    // The project id is minted here so the upload lands in its final home and we
    // never have to move a multi-hundred-megabyte file afterwards.
    if (!req.projectId) req.projectId = newProjectId();
    const dir = projectDir(req.projectId);
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `source${ext.toLowerCase()}`);
  }
});

/**
 * Recovers the real filename from multer's `originalname`.
 *
 * multipart headers carry no encoding declaration, so multer decodes the
 * filename as latin1 per the spec. Browsers send UTF-8, which means anything
 * non-ASCII arrives mangled — a Cyrillic name like "Неозаглавен дизайн.mp4"
 * surfaces as "ÐÐµÐ¾Ð·Ð°Ð³Ð»Ð°Ð²ÐµÐ½ Ð´Ð¸Ð·Ð°Ð¹Ð½.mp4". Re-decoding the same
 * bytes as UTF-8 restores it, and leaves pure-ASCII names untouched.
 */
function decodeFilename(name) {
  const raw = String(name ?? "");
  try {
    const decoded = Buffer.from(raw, "latin1").toString("utf8");
    // A failed round-trip yields replacement characters; keep the original then.
    return decoded.includes("�") ? raw : decoded;
  } catch {
    return raw;
  }
}

const upload = multer({
  storage,
  limits: { fileSize: 800 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    // Browsers usually send a video/* or audio/* mimetype, but plenty of clients
    // (and curl) send application/octet-stream, so fall back to the extension.
    const byMime = /^(video|audio)\//.test(file.mimetype);
    const byExt = /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|aac|flac|ogg)$/i.test(file.originalname);
    if (byMime || byExt) return cb(null, true);
    cb(Object.assign(new Error("Only video or audio files are supported"), { status: 400 }));
  }
});

const TRANSCRIPT_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", description: "BCP-47 code of the primary spoken language, e.g. en, bg" },
    summary: { type: "string", description: "2-3 sentence summary of what the video is about" },
    topics: {
      type: "array",
      description: "3-6 key topics discussed",
      items: { type: "string" }
    },
    segments: {
      type: "array",
      description: "Verbatim transcript split at natural sentence or thought boundaries",
      items: {
        type: "object",
        properties: {
          start: { type: "string", description: "Start time as MM:SS or HH:MM:SS" },
          end: { type: "string", description: "End time as MM:SS or HH:MM:SS" },
          text: { type: "string", description: "Verbatim spoken text for this segment" }
        },
        required: ["start", "end", "text"]
      }
    }
  },
  required: ["language", "summary", "topics", "segments"]
};

const TRANSCRIPT_PROMPT = `You are transcribing a video for a YouTube creator's production toolkit.

Transcribe the audio verbatim. Split the transcript into segments at natural sentence or
thought boundaries — aim for 5-15 seconds per segment, never longer than 20 seconds.
Timestamps must be accurate to the audio; they are used to cut real video clips, so a wrong
timestamp produces a broken clip.

Do not summarise, paraphrase, censor or clean up the speech inside segments. Keep filler words.
If the audio contains no intelligible speech, return an empty segments array.`;

/** POST /api/ingest — upload a video, transcribe it, return the project. */
router.post("/", upload.single("video"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw Object.assign(new Error("No file uploaded (expected field name 'video')"), { status: 400 });
    }

    const id = req.projectId;
    const videoPath = req.file.path;
    const media = await probe(videoPath);

    if (!media.hasAudio) {
      throw Object.assign(new Error("That file has no audio track, so it can't be transcribed."), {
        status: 400
      });
    }

    const project = createProject(id, {
      originalName: decodeFilename(req.file.originalname),
      videoPath,
      videoUrl: toPublicUrl(videoPath),
      media,
      status: "transcribing"
    });

    const audioPath = path.join(projectDir(id), "audio.mp3");
    await extractAudio(videoPath, audioPath);

    const started = Date.now();
    const raw = await generateJSON({
      model: MODELS.flash,
      label: "transcribe",
      input: [{ type: "text", text: TRANSCRIPT_PROMPT }, await audioPart(audioPath)],
      schema: TRANSCRIPT_SCHEMA
    });

    const segments = normalizeSegments(raw.segments, media.durationSec);

    const transcript = {
      language: raw.language,
      summary: raw.summary,
      topics: raw.topics ?? [],
      segments,
      wordCount: segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0),
      elapsedMs: Date.now() - started
    };

    updateProject(id, { audioPath, transcript, status: "ready" });

    res.json({ project: serialize(requireProject(id)) });
  } catch (error) {
    next(error);
  }
});

/** GET /api/ingest — list uploaded projects (populates the dashboard picker). */
router.get("/", (req, res) => {
  res.json({ projects: listProjects().map(serialize) });
});

/** GET /api/ingest/:id — one project with its transcript. */
router.get("/:id", (req, res, next) => {
  try {
    res.json({ project: serialize(requireProject(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

/** Strips absolute disk paths before sending state to the browser. */
function serialize(project) {
  const { videoPath, audioPath, ...safe } = project;
  return {
    ...safe,
    durationLabel: toTimestamp(project.media?.durationSec ?? 0)
  };
}

export default router;
export { serialize };
