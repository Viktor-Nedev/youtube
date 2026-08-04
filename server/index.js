import "dotenv/config";
import express from "express";
import cors from "cors";
import { DATA_DIR } from "./store.js";

import ingestRouter from "./routes/ingest.js";
import channelRouter from "./routes/channel.js";
import metadataRouter from "./routes/metadata.js";
import thumbnailRouter from "./routes/thumbnail.js";
import clipsRouter from "./routes/clips.js";
import commentsRouter from "./routes/comments.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "8mb" }));

// Generated artifacts (frames, thumbnails, clips) are served straight off disk.
app.use("/files", express.static(DATA_DIR, { maxAge: "1h" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    gemini: Boolean(process.env.GEMINI_API_KEY),
    youtube: Boolean(process.env.YOUTUBE_API_KEY),
    uptimeSec: Math.round(process.uptime())
  });
});

app.use("/api/ingest", ingestRouter);
app.use("/api/channel", channelRouter);
app.use("/api/metadata", metadataRouter);
app.use("/api/thumbnail", thumbnailRouter);
app.use("/api/clips", clipsRouter);
app.use("/api/comments", commentsRouter);

// Central error handler: every route can just throw.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error("[error]", err);
  res.status(status).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.warn("[server] GEMINI_API_KEY missing — AI modules will fail");
  if (!process.env.YOUTUBE_API_KEY) console.warn("[server] YOUTUBE_API_KEY missing — channel modules will fail");
});
