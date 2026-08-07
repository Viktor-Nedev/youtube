import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { decodeFilename } from "./utils/filename.js";

/**
 * Session state for the app.
 *
 * Projects live in memory (a hackathon demo is a single process, and the heavy
 * artifacts are on disk anyway). Channel fingerprints are persisted to disk
 * because they cost YouTube API quota to build and we don't want to re-spend it
 * on every restart.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, "..", "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const FINGERPRINTS_DIR = path.join(DATA_DIR, "fingerprints");
export const ASSETS_DIR = path.join(DATA_DIR, "assets");

for (const dir of [DATA_DIR, UPLOADS_DIR, FINGERPRINTS_DIR, ASSETS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/** @type {Map<string, object>} */
const projects = new Map();

export function newProjectId() {
  return crypto.randomBytes(6).toString("hex");
}

export function projectDir(id) {
  return path.join(UPLOADS_DIR, id);
}

function manifestPath(id) {
  return path.join(projectDir(id), "project.json");
}

/**
 * Projects are mirrored to disk beside their upload.
 *
 * Without this a server restart empties the project list while the browser is
 * still holding a project id, so every module fails with "Unknown project"
 * until you re-upload — which is exactly the kind of thing that bites during a
 * live demo. Transcripts and generated results are expensive to recreate, so
 * they survive the process.
 */
function persistProject(project) {
  fs.promises
    .writeFile(manifestPath(project.id), JSON.stringify(project, null, 2), "utf8")
    .catch((error) => console.warn(`[store] could not persist ${project.id}: ${error.message}`));
}

/** Rehydrates projects from disk at boot, newest first. */
function loadProjectsFromDisk() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return;
  }

  for (const dir of dirs) {
    try {
      const raw = fs.readFileSync(manifestPath(dir.name), "utf8");
      const project = JSON.parse(raw);
      // Drop entries whose media has been deleted underneath us.
      if (project.videoPath && !fs.existsSync(project.videoPath)) continue;

      // Self-heal names stored before the upload decoding was fixed. The repair
      // is idempotent, so running it on every boot is safe.
      const healed = decodeFilename(project.originalName);
      if (healed !== project.originalName) {
        project.originalName = healed;
        fs.writeFileSync(manifestPath(dir.name), JSON.stringify(project, null, 2), "utf8");
        console.log(`[store] repaired filename encoding for ${project.id}`);
      }

      projects.set(project.id, project);
    } catch {
      /* no manifest (or corrupt) — skip this directory */
    }
  }

  if (projects.size) console.log(`[store] restored ${projects.size} project(s) from disk`);
}

/** Path relative to DATA_DIR, expressed as a URL the frontend can load via /files. */
export function toPublicUrl(absolutePath) {
  const rel = path.relative(DATA_DIR, absolutePath).split(path.sep).join("/");
  return `/files/${rel}`;
}

export function createProject(id, data) {
  const project = { id, createdAt: Date.now(), ...data };
  projects.set(id, project);
  persistProject(project);
  return project;
}

export function getProject(id) {
  return projects.get(id);
}

export function requireProject(id) {
  const project = projects.get(id);
  if (!project) {
    const error = new Error(`Unknown project "${id}". Upload a video first.`);
    error.status = 404;
    throw error;
  }
  return project;
}

export function updateProject(id, patch) {
  const project = requireProject(id);
  Object.assign(project, patch);
  persistProject(project);
  return project;
}

export function listProjects() {
  return [...projects.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/* ---------- Channel fingerprint cache (disk-backed) ---------- */

function fingerprintPath(channelId) {
  return path.join(FINGERPRINTS_DIR, `${channelId}.json`);
}

export async function readFingerprint(channelId) {
  try {
    const raw = await fs.promises.readFile(fingerprintPath(channelId), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeFingerprint(channelId, fingerprint) {
  await fs.promises.writeFile(fingerprintPath(channelId), JSON.stringify(fingerprint, null, 2), "utf8");
  return fingerprint;
}

export async function listFingerprints() {
  const files = await fs.promises.readdir(FINGERPRINTS_DIR).catch(() => []);
  const results = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const data = await readFingerprint(path.basename(file, ".json"));
    if (data) {
      results.push({
        channelId: data.channel?.id,
        title: data.channel?.title,
        generatedAt: data.generatedAt
      });
    }
  }
  return results;
}

/**
 * The active fingerprint is process-wide: once a creator connects a channel,
 * every generation module is conditioned on it. This is the "spine" of the app.
 *
 * Persisted for the same reason projects are — a restart must not silently drop
 * every module back to generic, unconditioned output.
 */
const ACTIVE_CHANNEL_FILE = path.join(DATA_DIR, "active-channel.txt");

let activeChannelId = (() => {
  try {
    return fs.readFileSync(ACTIVE_CHANNEL_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
})();

export function setActiveChannel(channelId) {
  activeChannelId = channelId;
  fs.promises.writeFile(ACTIVE_CHANNEL_FILE, channelId ?? "", "utf8").catch(() => {});
}

export function getActiveChannelId() {
  return activeChannelId;
}

export async function getActiveFingerprint() {
  if (!activeChannelId) return null;
  return readFingerprint(activeChannelId);
}

// Restore prior state last, so every helper above is defined.
loadProjectsFromDisk();
