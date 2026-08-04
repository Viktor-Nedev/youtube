import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

/**
 * Thumbnail compositing.
 *
 * Text is rendered as an SVG layer composited by sharp rather than through
 * ffmpeg's drawtext: drawtext needs a libfreetype-enabled build plus awkward
 * Windows font-path escaping, and SVG gives us real typographic control
 * (stroke, tracking, multi-line balance) for free.
 */

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

// Heavy condensed faces read best at YouTube's shelf size. Listed as a stack so
// rendering degrades gracefully if a face is missing on the host.
const FONT_STACK = "'Anton', 'Impact', 'Arial Black', 'Segoe UI Black', 'DejaVu Sans', sans-serif";

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Greedy line wrap using an average-glyph-width estimate.
 * We can't measure text without a layout engine, but thumbnail text is short
 * (<=5 words by design) so an estimate is more than accurate enough.
 */
function wrapText(text, maxCharsPerLine) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);

  return lines.slice(0, 3);
}

/**
 * Builds the SVG text layer.
 * @param {string} text
 * @param {"left"|"right"|"center"} position
 * @param {string} accent  Hex colour for the text fill
 */
function buildTextSvg(text, position = "left", accent = "#FFE01A") {
  // Text occupies roughly half the frame so the subject stays visible.
  const boxWidth = position === "center" ? THUMB_WIDTH * 0.86 : THUMB_WIDTH * 0.52;
  const upper = String(text).toUpperCase();

  // Start large and shrink until the wrapped block fits the available box.
  let fontSize = 132;
  let lines = [];
  for (; fontSize >= 54; fontSize -= 6) {
    const avgGlyph = fontSize * 0.54;
    const maxChars = Math.max(6, Math.floor(boxWidth / avgGlyph));
    lines = wrapText(upper, maxChars);
    const widest = Math.max(...lines.map((l) => l.length)) * avgGlyph;
    if (widest <= boxWidth && lines.length <= 3) break;
  }

  const lineHeight = fontSize * 1.02;
  const blockHeight = lines.length * lineHeight;
  const startY = (THUMB_HEIGHT - blockHeight) / 2 + fontSize * 0.82;

  const anchor = position === "right" ? "end" : position === "center" ? "middle" : "start";
  const x = position === "right" ? THUMB_WIDTH - 64 : position === "center" ? THUMB_WIDTH / 2 : 64;

  const tspans = lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${startY + index * lineHeight}" text-anchor="${anchor}" class="t">${escapeXml(line)}</text>`
    )
    .join("");

  // Scrim behind the text so it stays legible over a busy frame.
  const scrim =
    position === "center"
      ? `<rect x="0" y="0" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" fill="url(#vign)"/>`
      : position === "right"
        ? `<rect x="${THUMB_WIDTH * 0.42}" y="0" width="${THUMB_WIDTH * 0.58}" height="${THUMB_HEIGHT}" fill="url(#fadeR)"/>`
        : `<rect x="0" y="0" width="${THUMB_WIDTH * 0.58}" height="${THUMB_HEIGHT}" fill="url(#fadeL)"/>`;

  return Buffer.from(`<svg width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fadeL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fadeR" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0%" stop-color="#000" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vign" cx="0.5" cy="0.5" r="0.75">
      <stop offset="40%" stop-color="#000" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.8"/>
    </radialGradient>
  </defs>
  ${scrim}
  <style>
    .t {
      font-family: ${FONT_STACK};
      font-size: ${fontSize}px;
      font-weight: 900;
      fill: ${accent};
      stroke: #000;
      stroke-width: ${Math.round(fontSize * 0.11)}px;
      paint-order: stroke fill;
      stroke-linejoin: round;
    }
  </style>
  ${tspans}
</svg>`);
}

/**
 * Renders the final thumbnail: crop the chosen frame to 16:9, punch the colour
 * slightly (thumbnails compete on a bright page), then composite the text.
 */
export async function renderThumbnail({ frameFile, text, outputPath, position = "left", accent = "#FFE01A" }) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const base = await sharp(frameFile)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: "cover", position: "attention" })
    .modulate({ saturation: 1.18, brightness: 1.04 })
    .linear(1.06, -8)
    .toBuffer();

  const layers = text ? [{ input: buildTextSvg(text, position, accent) }] : [];

  await sharp(base).composite(layers).png({ quality: 92 }).toFile(outputPath);
  return outputPath;
}

/** Small JPEG previews of the candidate frames for the selection grid. */
export async function makePreview(frameFile, outputPath, width = 480) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(frameFile).resize(width).jpeg({ quality: 78 }).toFile(outputPath);
  return outputPath;
}

/**
 * Caption strip for burned-in Shorts subtitles, rendered transparent so ffmpeg
 * can overlay it for the exact duration of its transcript segment.
 */
export async function renderCaptionStrip({ text, outputPath, width = 1080 }) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const fontSize = 54;
  const maxChars = Math.floor((width - 96) / (fontSize * 0.52));
  const lines = wrapText(String(text).toUpperCase(), maxChars);
  const lineHeight = fontSize * 1.24;
  const height = Math.ceil(lines.length * lineHeight + 48);

  const tspans = lines
    .map(
      (line, index) =>
        `<text x="${width / 2}" y="${32 + fontSize + index * lineHeight}" text-anchor="middle" class="c">${escapeXml(line)}</text>`
    )
    .join("");

  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .c {
      font-family: ${FONT_STACK};
      font-size: ${fontSize}px;
      font-weight: 900;
      fill: #fff;
      stroke: #000;
      stroke-width: 9px;
      paint-order: stroke fill;
      stroke-linejoin: round;
    }
  </style>
  ${tspans}
</svg>`);

  await sharp(svg).png().toFile(outputPath);
  return outputPath;
}

export { wrapText };
