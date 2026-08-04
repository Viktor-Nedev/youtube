import sharp from "sharp";

/**
 * Cheap, dependency-free frame quality scoring.
 *
 * This is a *pre-filter*, not the judge. Its only job is to take ~100 sampled
 * frames down to the best ~8 so we spend exactly one Gemini vision call instead
 * of a hundred. Gemini then does the part that actually needs semantics —
 * faces, expression, composition, click appeal.
 *
 * Deliberately no TensorFlow.js / MediaPipe here: they need node-gyp native
 * builds that routinely fail on Windows, and they'd be scoring the same thing
 * Gemini already scores better.
 */

const ANALYSIS_WIDTH = 320;

/** Downsamples to raw RGB once; every metric is computed from this one buffer. */
async function loadPixels(file) {
  const { data, info } = await sharp(file)
    .resize(ANALYSIS_WIDTH, null, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Variance of the Laplacian — the standard blur detector. A crisp frame has
 * lots of high-frequency edge energy; a motion-blurred one has almost none.
 */
function laplacianVariance(lum, width, height) {
  const values = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value =
        -4 * lum[i] + lum[i - 1] + lum[i + 1] + lum[i - width] + lum[i + width];
      values.push(value);
    }
  }
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
}

/**
 * Hasler & Süsstrunk colourfulness. Thumbnails that pop on a crowded homepage
 * are saturated and high-contrast; muddy frames score low here.
 */
function colorfulness(data, channels) {
  const rg = [];
  const yb = [];
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    rg.push(Math.abs(r - g));
    yb.push(Math.abs(0.5 * (r + g) - b));
  }
  const stats = (arr) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length);
    return { mean, std };
  };
  const a = stats(rg);
  const b = stats(yb);
  return Math.sqrt(a.std ** 2 + b.std ** 2) + 0.3 * Math.sqrt(a.mean ** 2 + b.mean ** 2);
}

/**
 * 64-bit difference hash, used only to drop near-identical frames. Sampling a
 * talking-head video every 2s produces long runs of nearly the same shot, and
 * without this the "top 8" would be eight copies of one moment.
 */
async function dHash(file) {
  const { data } = await sharp(file)
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = data[y * 9 + x];
      const right = data[y * 9 + x + 1];
      if (left > right) hash |= 1n << bit;
      bit += 1n;
    }
  }
  return hash;
}

function hammingDistance(a, b) {
  let diff = a ^ b;
  let count = 0;
  while (diff) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

/** Computes all quality metrics for a single frame. */
export async function scoreFrame(file) {
  const { data, width, height, channels } = await loadPixels(file);

  const lum = new Float64Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    const i = p * channels;
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const contrast = Math.sqrt(lum.reduce((acc, v) => acc + (v - mean) ** 2, 0) / lum.length);
  const sharpness = laplacianVariance(lum, width, height);
  const color = colorfulness(data, channels);
  const hash = await dHash(file);

  // Normalise each metric to roughly 0..1 before weighting.
  const nSharp = Math.min(1, Math.log10(1 + sharpness) / 3.2);
  const nColor = Math.min(1, color / 110);
  const nContrast = Math.min(1, contrast / 80);
  // Penalise frames that are crushed black or blown out (fades, cuts, flashes).
  const exposure = 1 - Math.min(1, Math.abs(mean - 128) / 128) ** 1.5;

  const score = 0.4 * nSharp + 0.25 * nColor + 0.2 * nContrast + 0.15 * exposure;

  return {
    file,
    metrics: {
      sharpness: Number(sharpness.toFixed(1)),
      colorfulness: Number(color.toFixed(1)),
      contrast: Number(contrast.toFixed(1)),
      brightness: Number(mean.toFixed(1))
    },
    score: Number(score.toFixed(4)),
    hash
  };
}

/**
 * Scores every frame, drops near-duplicates, returns the best `take`.
 *
 * @param {Array<{file: string, timeSec: number}>} frames
 * @param {object} [options]
 * @param {number} [options.take=8]           How many finalists to return
 * @param {number} [options.minDistance=10]   Hamming distance below which two frames are "the same shot"
 */
export async function rankFrames(frames, { take = 8, minDistance = 10 } = {}) {
  const scored = [];
  for (const frame of frames) {
    try {
      const result = await scoreFrame(frame.file);
      scored.push({ ...frame, ...result });
    } catch (error) {
      console.warn(`[frameScore] skipping ${frame.name}: ${error.message}`);
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const pick = (threshold) => {
    const finalists = [];
    for (const candidate of scored) {
      const isDuplicate = finalists.some((kept) => hammingDistance(kept.hash, candidate.hash) < threshold);
      if (!isDuplicate) finalists.push(candidate);
      if (finalists.length >= take) break;
    }
    return finalists;
  };

  // A locked-off talking-head shot is genuinely near-identical throughout, so a
  // fixed threshold can starve Gemini of candidates. Relax until we have enough
  // finalists (or run out of room to relax).
  let finalists = pick(minDistance);
  for (let threshold = minDistance - 2; finalists.length < take && threshold > 0; threshold -= 2) {
    finalists = pick(threshold);
  }

  // Fully static source: fall back to spreading picks across the timeline so the
  // grid still shows different moments rather than one frame.
  if (finalists.length < take && scored.length > finalists.length) {
    const byTime = [...scored].sort((a, b) => a.timeSec - b.timeSec);
    const stride = Math.max(1, Math.floor(byTime.length / take));
    for (let i = 0; i < byTime.length && finalists.length < take; i += stride) {
      if (!finalists.some((f) => f.file === byTime[i].file)) finalists.push(byTime[i]);
    }
  }

  return finalists.map(({ hash, ...rest }) => rest);
}

export { hammingDistance };
