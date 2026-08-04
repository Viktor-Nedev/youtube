import express from "express";
import { buildFingerprint } from "../services/fingerprint.js";
import { getComments, parseVideoId, getQuotaUsed } from "../services/youtube.js";
import {
  readFingerprint,
  writeFingerprint,
  listFingerprints,
  setActiveChannel,
  getActiveChannelId,
  getActiveFingerprint
} from "../store.js";

const router = express.Router();

/**
 * POST /api/channel/analyze — build (or reuse) a channel fingerprint.
 * Body: { channel: "@handle | url | UC...", limit?: number, refresh?: boolean }
 */
router.post("/analyze", async (req, res, next) => {
  try {
    const { channel, limit = 50, refresh = false } = req.body ?? {};
    if (!channel) {
      throw Object.assign(new Error("Provide a channel handle, URL or ID"), { status: 400 });
    }

    // Reuse the cached fingerprint unless explicitly refreshed — it costs real
    // API quota and a couple of Gemini calls to rebuild.
    if (!refresh && /^UC[\w-]{20,}$/.test(String(channel).trim())) {
      const cached = await readFingerprint(String(channel).trim());
      if (cached) {
        setActiveChannel(cached.channel.id);
        return res.json({ fingerprint: cached, cached: true });
      }
    }

    const fingerprint = await buildFingerprint(channel, { limit: Math.min(Number(limit) || 50, 50) });
    setActiveChannel(fingerprint.channel.id);

    res.json({ fingerprint, cached: false, quotaUnitsUsed: getQuotaUsed() });
  } catch (error) {
    next(error);
  }
});

/** GET /api/channel/active — the fingerprint currently conditioning every module. */
router.get("/active", async (req, res, next) => {
  try {
    const fingerprint = await getActiveFingerprint();
    res.json({ channelId: getActiveChannelId(), fingerprint });
  } catch (error) {
    next(error);
  }
});

/** GET /api/channel — previously analysed channels (disk cache). */
router.get("/", async (req, res, next) => {
  try {
    res.json({ channels: await listFingerprints() });
  } catch (error) {
    next(error);
  }
});

/** POST /api/channel/activate — switch the active channel without re-analysing. */
router.post("/activate", async (req, res, next) => {
  try {
    const { channelId } = req.body ?? {};
    const fingerprint = await readFingerprint(channelId);
    if (!fingerprint) throw Object.assign(new Error("No cached fingerprint for that channel"), { status: 404 });

    setActiveChannel(channelId);
    res.json({ fingerprint });
  } catch (error) {
    next(error);
  }
});

/** GET /api/channel/comments?video=<url|id> — raw comments, before moderation. */
router.get("/comments", async (req, res, next) => {
  try {
    const videoId = parseVideoId(req.query.video);
    const comments = await getComments(videoId, Number(req.query.limit) || 50);
    res.json({ videoId, comments });
  } catch (error) {
    next(error);
  }
});

export default router;
