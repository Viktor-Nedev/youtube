import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

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

/** Path relative to DATA_DIR, expressed as a URL the frontend can load via /files. */
export function toPublicUrl(absolutePath) {
  const rel = path.relative(DATA_DIR, absolutePath).split(path.sep).join("/");
  return `/files/${rel}`;
}

export function createProject(id, data) {
  const project = { id, createdAt: Date.now(), ...data };
  projects.set(id, project);
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
 */
let activeChannelId = null;

export function setActiveChannel(channelId) {
  activeChannelId = channelId;
}

export function getActiveChannelId() {
  return activeChannelId;
}

export async function getActiveFingerprint() {
  if (!activeChannelId) return null;
  return readFingerprint(activeChannelId);
}
