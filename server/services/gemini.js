import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

/**
 * Single entry point for every Gemini call in the app.
 *
 * Two rules enforced here, not at the call sites:
 *  1. Structured calls always go through a responseSchema. We never regex-parse prose.
 *  2. Everything retries on transient 429/503, because a live demo can't afford a blip.
 */

export const MODELS = {
  // Workhorse: text + vision + audio, 1M context.
  flash: "gemini-3.6-flash",
  // Cheaper/faster, used for high-volume classification (comments).
  lite: "gemini-3.5-flash-lite",
  // Image generation/editing (Nano Banana 2).
  image: "gemini-3.1-flash-image"
};

// Inline request bodies are capped at 20MB total; above that we must use the Files API.
const INLINE_LIMIT_BYTES = 18 * 1024 * 1024;

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey"
      );
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const MIME_BY_EXT = {
  ".mp3": "audio/mp3",
  ".wav": "audio/wav",
  ".m4a": "audio/m4a",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

export function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`Unsupported media type for Gemini: ${ext}`);
  return mime;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(error) {
  const status = error?.status ?? error?.code;
  if (status === 429 || status === 503 || status === 500) return true;
  const message = String(error?.message || "");
  return /rate limit|overloaded|unavailable|deadline|ECONNRESET|fetch failed/i.test(message);
}

async function withRetry(fn, { attempts = 4, label = "gemini" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) break;
      const backoff = 800 * 2 ** (attempt - 1);
      console.warn(`[${label}] attempt ${attempt} failed (${error.message}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastError;
}

/**
 * Builds an audio input part, transparently choosing inline bytes vs the Files API
 * based on file size. Callers don't need to care which path was taken.
 */
export async function audioPart(filePath) {
  const { size } = await fs.promises.stat(filePath);
  const mime = mimeFor(filePath);

  if (size <= INLINE_LIMIT_BYTES) {
    const data = await fs.promises.readFile(filePath, { encoding: "base64" });
    return { type: "audio", data, mime_type: mime };
  }

  const uploaded = await withRetry(
    () => getClient().files.upload({ file: filePath, config: { mimeType: mime } }),
    { label: "files.upload" }
  );
  return { type: "audio", uri: uploaded.uri, mime_type: uploaded.mimeType || mime };
}

/** Builds an inline image part from a file on disk. */
export async function imagePart(filePath) {
  const data = await fs.promises.readFile(filePath, { encoding: "base64" });
  return { type: "image", data, mime_type: mimeFor(filePath) };
}

/**
 * Schema-enforced generation. Returns parsed JSON matching `schema`.
 *
 * @param {object} options
 * @param {Array|string} options.input   Interactions API input (string or parts array)
 * @param {object} options.schema        JSON Schema the response must conform to
 * @param {string} [options.model]       Defaults to the flash workhorse
 * @param {string} [options.system]      Optional system instruction
 * @param {string} [options.label]       Log label
 */
export async function generateJSON({ input, schema, model = MODELS.flash, system, label = "generateJSON" }) {
  const parts = typeof input === "string" ? [{ type: "text", text: input }] : input;
  const finalInput = system ? [{ type: "text", text: system }, ...parts] : parts;

  const interaction = await withRetry(
    () =>
      getClient().interactions.create({
        model,
        input: finalInput,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema
        }
      }),
    { label }
  );

  const raw = interaction.output_text;
  if (!raw) throw new Error(`[${label}] Gemini returned an empty response`);

  try {
    return JSON.parse(raw);
  } catch {
    // Schema mode should make this unreachable, but a demo should never hard-crash
    // on a stray code fence.
    const salvaged = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    return JSON.parse(salvaged);
  }
}

/** Plain text generation, for the rare case we don't want structure. */
export async function generateText({ input, model = MODELS.flash, label = "generateText" }) {
  const parts = typeof input === "string" ? [{ type: "text", text: input }] : input;
  const interaction = await withRetry(
    () => getClient().interactions.create({ model, input: parts }),
    { label }
  );
  return interaction.output_text ?? "";
}

export { getClient };
