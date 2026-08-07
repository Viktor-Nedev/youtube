import fs from "node:fs";
import path from "node:path";

/**
 * Builds ASS subtitle files for burned-in short-form captions.
 *
 * ASS is used rather than compositing PNGs because the bundled ffmpeg ships
 * with libass, freetype, harfbuzz and fribidi, which makes word-level timing,
 * per-style rendering, positioning and animation native features. A one-word
 * cue every ~300ms would otherwise mean ~100 image inputs per clip.
 *
 * Known limitation, verified rather than assumed: libass renders emoji as
 * monochrome glyphs because it does not rasterise colour font layers. Colour
 * emoji are therefore composited separately as Twemoji PNGs — see
 * `emojiOverlays` below.
 */

export const SUBTITLE_STYLES = ["pop", "karaoke", "box", "typewriter"];
export const SUBTITLE_POSITIONS = ["top", "middle", "bottom"];
export const SUBTITLE_ANIMATIONS = ["pop", "fade", "slide", "none"];

const PLAY_W = 1080;
const PLAY_H = 1920;

// Heavy condensed faces are the short-form convention; resolved by fontconfig.
const FONT = "Arial Black";

/** ASS colours are &HAABBGGRR — blue and red swapped relative to CSS hex. */
function assColour(hex, alpha = "00") {
  const clean = String(hex).replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = full.slice(0, 2);
  const g = full.slice(2, 4);
  const b = full.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/** ASS timestamps are H:MM:SS.cc with centisecond precision. */
function assTime(seconds) {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(Math.min(cs, 99))}`;
}

/** Braces and newlines are ASS override syntax and must not leak from text. */
function escapeText(text) {
  return String(text).replace(/[{}]/g, "").replace(/\r?\n/g, " ").trim();
}

/** numpad-style alignment: 8 top-centre, 5 middle-centre, 2 bottom-centre. */
const ALIGNMENT = { top: 8, middle: 5, bottom: 2 };

/** Entry animation as ASS override tags, applied per cue. */
function animationTags(animation, durationMs) {
  const hold = Math.min(140, Math.max(60, durationMs * 0.25));

  switch (animation) {
    case "pop":
      // Overshoot then settle — the standard short-form caption snap.
      return `\\fad(60,60)\\fscx70\\fscy70\\t(0,${Math.round(hold)},\\fscx112\\fscy112)\\t(${Math.round(hold)},${Math.round(hold * 1.8)},\\fscx100\\fscy100)`;
    case "fade":
      return `\\fad(${Math.round(hold)},${Math.round(hold)})`;
    case "slide":
      return `\\fad(50,50)\\move(${PLAY_W / 2},${PLAY_H / 2 + 60},${PLAY_W / 2},${PLAY_H / 2},0,${Math.round(hold * 2)})`;
    default:
      return "";
  }
}

/** Relative luminance, to decide whether text on a colour should be black or white. */
function isLightColour(hex) {
  const clean = String(hex).replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55;
}

function styleBlock({ style, position, accent, fontSize, marginV }) {
  const alignment = ALIGNMENT[position] ?? ALIGNMENT.bottom;
  const highlight = assColour(accent);

  // BorderStyle 3 draws an opaque box instead of an outline — and libass fills
  // that box from OutlineColour, not BackColour, so the accent goes there.
  const boxed = style === "box";
  const borderStyle = boxed ? 3 : 1;
  const outlineWidth = boxed ? 14 : Math.max(4, Math.round(fontSize * 0.09));

  // Inside a coloured box the text must contrast with the box, not the video.
  const primary = boxed
    ? assColour(isLightColour(accent) ? "#000000" : "#FFFFFF")
    : assColour("#FFFFFF");
  const outline = boxed ? highlight : assColour("#000000");
  const backColour = boxed ? highlight : assColour("#000000", "80");

  return [
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Main,${FONT},${fontSize},${primary},${highlight},${outline},${backColour},-1,0,0,0,100,100,0,0,${borderStyle},${outlineWidth},0,${alignment},80,80,${marginV},1`
  ].join("\n");
}

/**
 * Builds the Dialogue events for a style.
 *
 * @param {Array<{text:string,start:number,end:number}>} cues
 * @param {Array<{word:string,start:number,end:number}>} words  ungrouped, for phrase styles
 */
function buildEvents({ cues, words, style, animation, accent }) {
  const lines = [];
  const highlight = assColour(accent);

  const emit = (start, end, text, tags = "") => {
    if (!(end > start)) return;
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Main,,0,0,0,,{${tags}}${text}`);
  };

  if (style === "pop" || style === "box") {
    // One cue on screen at a time — the dominant short-form look.
    for (const cue of cues) {
      const ms = (cue.end - cue.start) * 1000;
      emit(cue.start, cue.end, escapeText(cue.text).toUpperCase(), animationTags(animation, ms));
    }
    return lines;
  }

  if (style === "karaoke") {
    // The whole phrase stays up; the spoken word lights in the accent colour.
    // Four words is what reliably fits two wrapped lines at this size.
    const phrases = chunk(words, 4);
    for (const phrase of phrases) {
      const phraseStart = phrase[0].start;
      const phraseEnd = phrase[phrase.length - 1].end;

      phrase.forEach((active, index) => {
        const text = phrase
          .map((w, i) =>
            i === index
              ? `{\\c${highlight}\\fscx108\\fscy108}${escapeText(w.word).toUpperCase()}{\\c${assColour("#FFFFFF")}\\fscx100\\fscy100}`
              : escapeText(w.word).toUpperCase()
          )
          .join(" ");

        const start = active.start;
        const end = index === phrase.length - 1 ? phraseEnd : phrase[index + 1].start;
        // Only the first cue of a phrase animates in; the rest would strobe.
        emit(start, end, text, index === 0 ? animationTags(animation, (end - start) * 1000) : "");
      });
    }
    return lines;
  }

  if (style === "typewriter") {
    // Words accumulate, then the line clears and the next phrase begins.
    const phrases = chunk(words, 6);
    for (const phrase of phrases) {
      const phraseEnd = phrase[phrase.length - 1].end;
      phrase.forEach((word, index) => {
        const text = phrase
          .slice(0, index + 1)
          .map((w) => escapeText(w.word).toUpperCase())
          .join(" ");
        const end = index === phrase.length - 1 ? phraseEnd : phrase[index + 1].start;
        emit(word.start, end, text, index === 0 ? animationTags(animation, 200) : "");
      });
    }
    return lines;
  }

  return lines;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.filter((group) => group.length);
}

/**
 * Writes an .ass file and returns its path.
 *
 * @param {object} options
 * @param {Array} options.words          Word timings relative to the clip
 * @param {Array} options.cues           Grouped cues (1-2 words) relative to the clip
 * @param {string} options.outputPath
 * @param {"pop"|"karaoke"|"box"|"typewriter"} [options.style]
 * @param {"top"|"middle"|"bottom"} [options.position]
 * @param {"pop"|"fade"|"slide"|"none"} [options.animation]
 * @param {string} [options.accent]      Highlight colour as CSS hex
 * @param {number} [options.fontSize]
 * @param {number} [options.marginV]     Distance from the aligned edge
 */
export async function buildAssFile({
  words,
  cues,
  outputPath,
  style = "pop",
  position = "bottom",
  animation = "pop",
  accent = "#FFE01A",
  fontSize = 108,
  marginV = 320
}) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  // Phrase styles must wrap or they run off the 1080px frame; single-cue styles
  // must NOT wrap, so a two-word cue never splits across lines.
  const phraseStyle = style === "karaoke" || style === "typewriter";
  const wrapStyle = phraseStyle ? 0 : 2;

  // A phrase needs a smaller face than a single word to fit the same width.
  const effectiveFontSize = phraseStyle ? Math.round(fontSize * 0.66) : fontSize;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${PLAY_W}`,
    `PlayResY: ${PLAY_H}`,
    `WrapStyle: ${wrapStyle}`,
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    ""
  ].join("\n");

  const styles = styleBlock({ style, position, accent, fontSize: effectiveFontSize, marginV });

  const events = [
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...buildEvents({ cues, words, style, animation, accent })
  ].join("\n");

  await fs.promises.writeFile(outputPath, `${header}${styles}${events}\n`, "utf8");
  return outputPath;
}

/**
 * Picks emoji overlay placements for a clip.
 *
 * Emoji sit on their own line offset from the caption rather than inline,
 * because aligning a raster image with text drawn by libass would need font
 * metrics we do not have. Offsetting also happens to be the common short-form
 * treatment: a large emoji above the caption.
 *
 * @param {Array<{emoji:string,start:number,end:number}>} suggestions
 * @param {string} position  Caption position, so the emoji lands clear of it
 */
export function emojiOverlays(suggestions, position = "bottom") {
  // Chosen to sit clear of the caption band for each alignment.
  const y = { bottom: 1340, middle: 780, top: 520 }[position] ?? 1340;

  return (suggestions ?? [])
    .filter((s) => s.codepoint && s.end > s.start)
    .map((s) => ({ ...s, y }));
}

export { assColour, assTime };
