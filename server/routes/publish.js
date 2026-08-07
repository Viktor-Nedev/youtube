import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  buildAuthUrl,
  exchangeCode,
  isConfigured,
  isConnected,
  clearTokens
} from "../services/googleAuth.js";
import { uploadVideo, getMyChannel } from "../services/youtubeUpload.js";
import { DATA_DIR, requireProject, projectDir } from "../store.js";

const router = express.Router();

/**
 * The scheduling queue.
 *
 * Kept on disk rather than in memory because a schedule that vanishes when the
 * server restarts is worse than no schedule at all. YouTube itself holds the
 * publish time once a video is uploaded — this queue tracks what we have sent
 * and what is still waiting.
 */
const QUEUE_FILE = path.join(DATA_DIR, "schedule.json");

function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeQueue(items) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2), "utf8");
}

/* ---------- auth ---------- */

/** GET /api/auth/status — is OAuth configured, and are we connected? */
router.get("/auth/status", async (req, res) => {
  const configured = isConfigured();
  const connected = configured && isConnected();

  let channel = null;
  if (connected) {
    channel = await getMyChannel().catch(() => null);
  }

  res.json({
    configured,
    connected,
    channel,
    // Tells the UI exactly what is missing rather than just failing later.
    hint: configured
      ? null
      : "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env. Create them in Google Cloud Console under Credentials > OAuth client ID > Web application, with redirect URI http://localhost:8787/api/auth/callback"
  });
});

/** GET /api/auth/google — start the consent flow. */
router.get("/auth/google", (req, res, next) => {
  try {
    res.redirect(buildAuthUrl());
  } catch (error) {
    next(error);
  }
});

/** GET /api/auth/callback — Google redirects here with the code. */
router.get("/auth/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) throw new Error(String(error));
    await exchangeCode(String(code), String(state));
    // Back to the app rather than leaving the user on a bare JSON response.
    res.redirect("http://localhost:5173/app/schedule?connected=1");
  } catch (err) {
    res.redirect(`http://localhost:5173/app/schedule?error=${encodeURIComponent(err.message)}`);
  }
});

/** POST /api/auth/disconnect */
router.post("/auth/disconnect", (req, res) => {
  clearTokens();
  res.json({ ok: true });
});

/* ---------- publishing ---------- */

/**
 * POST /api/publish
 * Body: { projectId, source: "source"|"clip", clipIndex?, title, description?, tags?,
 *         publishAt?, privacyStatus? }
 */
router.post("/publish", async (req, res, next) => {
  try {
    const {
      projectId,
      source = "source",
      clipIndex,
      title,
      description = "",
      tags = [],
      publishAt = null,
      privacyStatus = "private"
    } = req.body ?? {};

    const project = requireProject(projectId);
    if (!title?.trim()) {
      throw Object.assign(new Error("A title is required."), { status: 400 });
    }

    // Resolve which file is being published.
    let filePath = project.videoPath;
    if (source === "clip") {
      const index = Number(clipIndex);
      const clip = project.clips?.clips?.find((c) => c.index === index);
      if (!clip) throw Object.assign(new Error(`No clip ${clipIndex} on this project.`), { status: 404 });
      filePath = path.join(projectDir(project.id), "clips", `clip-${index}.mp4`);
    }

    if (!fs.existsSync(filePath)) {
      throw Object.assign(new Error("That video file no longer exists on disk."), { status: 404 });
    }

    if (publishAt && new Date(publishAt).getTime() < Date.now()) {
      throw Object.assign(new Error("Scheduled time is in the past."), { status: 400 });
    }

    const result = await uploadVideo({
      filePath,
      title: title.trim(),
      description,
      tags,
      privacyStatus,
      publishAt
    });

    const entry = {
      id: crypto.randomBytes(6).toString("hex"),
      projectId,
      source,
      clipIndex: source === "clip" ? Number(clipIndex) : null,
      title: result.title,
      videoId: result.videoId,
      url: result.url,
      studioUrl: result.studioUrl,
      publishAt: result.publishAt,
      privacyStatus: result.privacyStatus,
      uploadedAt: new Date().toISOString()
    };

    writeQueue([entry, ...readQueue()]);
    res.json({ published: entry });
  } catch (error) {
    next(error);
  }
});

/** GET /api/schedule — everything uploaded or scheduled from this app. */
router.get("/schedule", (req, res) => {
  res.json({ items: readQueue() });
});

/** DELETE /api/schedule/:id — forget a queue entry (does not touch YouTube). */
router.delete("/schedule/:id", (req, res) => {
  const remaining = readQueue().filter((item) => item.id !== req.params.id);
  writeQueue(remaining);
  res.json({ ok: true, items: remaining });
});

export default router;
