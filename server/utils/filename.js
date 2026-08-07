/**
 * Recovers real filenames from multipart upload headers.
 *
 * multipart/form-data carries no encoding declaration for the filename, so
 * multer decodes it as latin1 per the spec. Browsers send UTF-8 bytes, which
 * means anything non-ASCII arrives mangled: "Неозаглавен дизайн.mp4" surfaces
 * as "ÐÐµÐ¾Ð·Ð°Ð³Ð»Ð°Ð²ÐµÐ½ Ð´Ð¸Ð·Ð°Ð¹Ð½.mp4".
 */

/**
 * True when every code point fits in a byte, i.e. the string could plausibly be
 * latin1-decoded bytes rather than real text.
 *
 * This guard is what makes the repair **idempotent**. Naively running
 * latin1 -> utf8 over an already-correct "Тестово видео.mp4" would shred it,
 * and the repair now runs on every restart, so it must be safe to reapply.
 */
function looksLikeLatin1Bytes(value) {
  for (const char of value) {
    if (char.codePointAt(0) > 0xff) return false;
  }
  return true;
}

/**
 * Signature of UTF-8 misread as latin1: a lead byte (C2-DF for two-byte
 * sequences, E0-EF for three-byte) followed by a continuation byte in 80-BF.
 *
 * Built with explicit escapes because the continuation range is control
 * characters, which do not survive being typed literally into source.
 */
const MOJIBAKE_MARKERS = new RegExp("[\\u00C2-\\u00EF][\\u0080-\\u00BF]");

/**
 * Repairs a mangled filename, leaving correct ones untouched.
 * Safe to call more than once on the same value.
 */
export function decodeFilename(name) {
  const raw = String(name ?? "");
  if (!raw) return raw;

  // Already contains real non-Latin characters — nothing to repair.
  if (!looksLikeLatin1Bytes(raw)) return raw;
  // Pure ASCII, or no mojibake signature: leave it alone.
  if (!MOJIBAKE_MARKERS.test(raw)) return raw;

  try {
    const decoded = Buffer.from(raw, "latin1").toString("utf8");
    // A failed round-trip yields U+FFFD; keep the original in that case.
    return decoded.includes("�") ? raw : decoded;
  } catch {
    return raw;
  }
}

/**
 * Reads the filename from a multer file, preferring the RFC 5987
 * `filename*=UTF-8''...` parameter when the client sends one, since that form
 * is unambiguous and needs no repair.
 */
export function filenameFromUpload(file) {
  const disposition = file?.headers?.["content-disposition"] ?? "";
  const encoded = /filename\*=UTF-8''([^;\r\n]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      /* fall through to the latin1 repair */
    }
  }
  return decodeFilename(file?.originalname);
}
