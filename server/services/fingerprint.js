import { generateJSON, MODELS } from "./gemini.js";
import { getChannel, getUploadIds, getVideos, getQuotaUsed } from "./youtube.js";
import { writeFingerprint } from "../store.js";

/**
 * The Channel Fingerprint — the spine of the app.
 *
 * Derives what actually works *for one specific channel* and feeds that profile
 * into every generation module, so output stops being generic SEO advice.
 *
 * Division of labour, and it matters:
 *   - Gemini does semantics: labelling a title's structure, naming topic clusters.
 *   - This file does arithmetic: every lift, median and ratio is computed in code
 *     from the real statistics we fetched.
 *
 * An LLM asked to compute "2.3x lift" will happily invent a plausible number.
 * Anything we show a creator (or a judge) as a statistic has to be reproducible,
 * so the model never gets to do the maths.
 */

// Fixed taxonomy: a stable label set is what makes lift comparable across videos.
export const TITLE_FEATURES = [
  "question",
  "number_listicle",
  "how_to",
  "personal_story",
  "superlative",
  "curiosity_gap",
  "negative_framing",
  "urgency",
  "named_entity",
  "allcaps_emphasis"
];

// Videos younger than this haven't accumulated their views yet; including them
// would make every recent upload look like a failure.
const MATURITY_DAYS = 14;
const MIN_SUPPORT = 3; // Minimum videos on each side before we trust a lift.

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

const LABEL_SCHEMA = {
  type: "object",
  properties: {
    videos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          features: {
            type: "array",
            description: `Structural features present in the title. Only use values from: ${TITLE_FEATURES.join(", ")}`,
            items: { type: "string", enum: TITLE_FEATURES }
          },
          topic: {
            type: "string",
            description: "Short topic label, 1-3 words, reused verbatim across videos on the same subject"
          }
        },
        required: ["id", "features", "topic"]
      }
    }
  },
  required: ["videos"]
};

const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    positioning: {
      type: "string",
      description: "2-3 sentences describing what this channel is and who it serves"
    },
    voice: {
      type: "string",
      description: "The channel's title-writing voice, concrete enough to imitate"
    },
    thumbnailStyle: {
      type: "string",
      description: "Guidance for thumbnail text and framing that fits this channel"
    },
    winningFormula: {
      type: "string",
      description: "One actionable sentence: what this channel should keep doing"
    },
    underperformers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          hypotheses: {
            type: "array",
            description: "2-3 concrete reasons this video underperformed",
            items: { type: "string" }
          },
          rewrittenTitle: { type: "string", description: "A stronger title for this exact video" }
        },
        required: ["id", "hypotheses", "rewrittenTitle"]
      }
    }
  },
  required: ["positioning", "voice", "thumbnailStyle", "winningFormula", "underperformers"]
};

/** Computes lift for one boolean grouping, with a support guard. */
function computeLift(withGroup, withoutGroup) {
  if (withGroup.length < MIN_SUPPORT || withoutGroup.length < MIN_SUPPORT) return null;

  const withMedian = median(withGroup.map((v) => v.views));
  const withoutMedian = median(withoutGroup.map((v) => v.views));
  if (!withoutMedian) return null;

  return {
    lift: Number((withMedian / withoutMedian).toFixed(2)),
    withMedian: Math.round(withMedian),
    withoutMedian: Math.round(withoutMedian),
    sampleSize: withGroup.length
  };
}

function durationBucket(sec) {
  if (sec <= 60) return "short (<=60s)";
  if (sec <= 300) return "5 min or less";
  if (sec <= 600) return "5-10 min";
  if (sec <= 1200) return "10-20 min";
  if (sec <= 2400) return "20-40 min";
  return "40 min+";
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Builds (and caches) the fingerprint for a channel.
 *
 * @param {string} channelInput  Handle, URL or channel id
 * @param {object} [options]
 * @param {number} [options.limit=50]  How many recent uploads to analyse
 */
export async function buildFingerprint(channelInput, { limit = 50 } = {}) {
  const quotaBefore = getQuotaUsed();

  const channel = await getChannel(channelInput);
  const ids = await getUploadIds(channel.uploadsPlaylistId, limit);
  const allVideos = await getVideos(ids);

  if (!allVideos.length) {
    throw Object.assign(new Error(`Channel "${channel.title}" has no public videos to analyse.`), {
      status: 400
    });
  }

  // Only mature videos inform the patterns, but we keep the rest for display.
  const mature = allVideos.filter((v) => daysSince(v.publishedAt) >= MATURITY_DAYS);
  const analysed = mature.length >= 5 ? mature : allVideos;

  const medianViews = median(analysed.map((v) => v.views));
  const withRatio = allVideos.map((video) => ({
    ...video,
    performanceRatio: medianViews ? Number((video.views / medianViews).toFixed(2)) : 1,
    isMature: daysSince(video.publishedAt) >= MATURITY_DAYS
  }));

  // --- Gemini pass 1: label title structure and topic (semantics only) ---
  const labelInput = `Label each YouTube title below.

For "features", list every structural feature the title genuinely uses. Use ONLY these values:
${TITLE_FEATURES.join(", ")}

For "topic", give a short 1-3 word subject label. Reuse the exact same label across videos
about the same subject so the labels can be grouped.

Do not consider view counts — they are deliberately not shown to you. Label the titles only.

${analysed.map((v) => `${v.id} :: ${v.title}`).join("\n")}`;

  const labelled = await generateJSON({
    input: labelInput,
    schema: LABEL_SCHEMA,
    model: MODELS.flash,
    label: "fingerprint:labels"
  });

  const labelById = new Map(labelled.videos.map((v) => [v.id, v]));
  const analysedWithLabels = analysed.map((video) => ({
    ...video,
    // Carried here as well as on `withRatio` because the underperformer prompt
    // and payload below both read it off this array.
    performanceRatio: medianViews ? Number((video.views / medianViews).toFixed(2)) : 1,
    features: labelById.get(video.id)?.features ?? [],
    topic: labelById.get(video.id)?.topic ?? "uncategorised"
  }));

  // --- Arithmetic pass: every number below is computed here, not by the model ---
  const titlePatterns = [];
  for (const feature of TITLE_FEATURES) {
    const withGroup = analysedWithLabels.filter((v) => v.features.includes(feature));
    const withoutGroup = analysedWithLabels.filter((v) => !v.features.includes(feature));
    const result = computeLift(withGroup, withoutGroup);
    if (result) {
      titlePatterns.push({
        feature,
        ...result,
        examples: withGroup
          .sort((a, b) => b.views - a.views)
          .slice(0, 2)
          .map((v) => ({ id: v.id, title: v.title, views: v.views }))
      });
    }
  }
  titlePatterns.sort((a, b) => b.lift - a.lift);

  const durationGroups = new Map();
  for (const video of analysedWithLabels) {
    const bucket = durationBucket(video.durationSec);
    if (!durationGroups.has(bucket)) durationGroups.set(bucket, []);
    durationGroups.get(bucket).push(video);
  }
  const durationPerformance = [...durationGroups.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([bucket, group]) => ({
      bucket,
      medianViews: Math.round(median(group.map((v) => v.views))),
      count: group.length
    }))
    .sort((a, b) => b.medianViews - a.medianViews);

  const dayGroups = new Map();
  for (const video of analysedWithLabels) {
    const day = DAY_NAMES[new Date(video.publishedAt).getUTCDay()];
    if (!dayGroups.has(day)) dayGroups.set(day, []);
    dayGroups.get(day).push(video);
  }
  const publishDayPerformance = [...dayGroups.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([day, group]) => ({
      day,
      medianViews: Math.round(median(group.map((v) => v.views))),
      count: group.length
    }))
    .sort((a, b) => b.medianViews - a.medianViews);

  const topicGroups = new Map();
  for (const video of analysedWithLabels) {
    const key = video.topic.toLowerCase();
    if (!topicGroups.has(key)) topicGroups.set(key, []);
    topicGroups.get(key).push(video);
  }
  const topicPerformance = [...topicGroups.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([topic, group]) => ({
      topic,
      medianViews: Math.round(median(group.map((v) => v.views))),
      count: group.length,
      lift: medianViews ? Number((median(group.map((v) => v.views)) / medianViews).toFixed(2)) : 1
    }))
    .sort((a, b) => b.medianViews - a.medianViews);

  const underperformers = analysedWithLabels
    .filter((v) => v.views < medianViews)
    .sort((a, b) => a.views / (medianViews || 1) - b.views / (medianViews || 1))
    .slice(0, 5);

  // --- Gemini pass 2: qualitative synthesis, handed the numbers we computed ---
  const insightInput = `You are a YouTube strategist analysing one channel's real performance data.

CHANNEL: ${channel.title} (${channel.subscribers.toLocaleString()} subscribers, ${channel.videoCount} videos)
Description: ${channel.description?.slice(0, 500) || "(none)"}

Median views across the ${analysedWithLabels.length} analysed videos: ${Math.round(medianViews).toLocaleString()}

TITLE PATTERNS (lift = median views with the feature vs without; computed from real data):
${titlePatterns.map((p) => `- ${p.feature}: ${p.lift}x (${p.sampleSize} videos, ${p.withMedian.toLocaleString()} vs ${p.withoutMedian.toLocaleString()} views)`).join("\n") || "- not enough data"}

DURATION PERFORMANCE:
${durationPerformance.map((d) => `- ${d.bucket}: ${d.medianViews.toLocaleString()} median views (${d.count} videos)`).join("\n") || "- not enough data"}

TOPIC PERFORMANCE:
${topicPerformance.map((t) => `- ${t.topic}: ${t.medianViews.toLocaleString()} median views (${t.count} videos, ${t.lift}x channel median)`).join("\n") || "- not enough data"}

TOP PERFORMERS:
${analysedWithLabels.sort((a, b) => b.views - a.views).slice(0, 5).map((v) => `- "${v.title}" — ${v.views.toLocaleString()} views`).join("\n")}

UNDERPERFORMERS needing diagnosis:
${underperformers.map((v) => `- ${v.id} :: "${v.title}" — ${v.views.toLocaleString()} views (${v.performanceRatio}x median), ${Math.round(v.durationSec / 60)} min`).join("\n") || "- none"}

Ground every claim in the data above. Do not invent statistics or cite numbers that
are not listed here. Diagnose each underperformer by contrasting it with what the
patterns show works for this channel.`;

  const insights = await generateJSON({
    input: insightInput,
    schema: INSIGHT_SCHEMA,
    model: MODELS.flash,
    label: "fingerprint:insights"
  });

  const underperformerById = new Map(underperformers.map((v) => [v.id, v]));
  const diagnosedUnderperformers = insights.underperformers
    .filter((u) => underperformerById.has(u.id))
    .map((u) => {
      const video = underperformerById.get(u.id);
      return {
        ...u,
        title: video.title,
        views: video.views,
        performanceRatio: video.performanceRatio,
        thumbnail: video.thumbnail
      };
    });

  const fingerprint = {
    generatedAt: new Date().toISOString(),
    channel: {
      id: channel.id,
      title: channel.title,
      customUrl: channel.customUrl,
      thumbnail: channel.thumbnail,
      subscribers: channel.subscribers,
      videoCount: channel.videoCount
    },
    stats: {
      analysedCount: analysedWithLabels.length,
      totalFetched: allVideos.length,
      medianViews: Math.round(medianViews),
      maturityDays: MATURITY_DAYS,
      quotaUnitsUsed: getQuotaUsed() - quotaBefore
    },
    titlePatterns,
    durationPerformance,
    publishDayPerformance,
    topicPerformance,
    insights: {
      positioning: insights.positioning,
      voice: insights.voice,
      thumbnailStyle: insights.thumbnailStyle,
      winningFormula: insights.winningFormula
    },
    underperformers: diagnosedUnderperformers,
    videos: withRatio.map((v) => ({
      id: v.id,
      title: v.title,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      durationSec: v.durationSec,
      publishedAt: v.publishedAt,
      thumbnail: v.thumbnail,
      performanceRatio: v.performanceRatio,
      isMature: v.isMature,
      features: labelById.get(v.id)?.features ?? [],
      topic: labelById.get(v.id)?.topic ?? null
    }))
  };

  await writeFingerprint(channel.id, fingerprint);
  return fingerprint;
}

/**
 * Condenses a fingerprint into prompt context for the generation modules.
 * This is what makes metadata/thumbnail/clip output channel-specific.
 */
export function fingerprintToPromptContext(fingerprint) {
  if (!fingerprint) return "";

  const winning = fingerprint.titlePatterns.filter((p) => p.lift > 1.15).slice(0, 4);
  const losing = fingerprint.titlePatterns.filter((p) => p.lift < 0.85).slice(0, 2);
  const bestDuration = fingerprint.durationPerformance[0];

  return `CHANNEL FINGERPRINT — "${fingerprint.channel.title}" (${fingerprint.channel.subscribers.toLocaleString()} subs)
Derived from the ${fingerprint.stats.analysedCount} most recent videos. Median views: ${fingerprint.stats.medianViews.toLocaleString()}.

Positioning: ${fingerprint.insights.positioning}
Title voice to imitate: ${fingerprint.insights.voice}
Winning formula: ${fingerprint.insights.winningFormula}

Title features that OUTPERFORM on this channel:
${winning.map((p) => `- ${p.feature}: ${p.lift}x median views (across ${p.sampleSize} videos)`).join("\n") || "- no strong signal yet"}
${losing.length ? `\nTitle features that UNDERPERFORM here:\n${losing.map((p) => `- ${p.feature}: ${p.lift}x`).join("\n")}` : ""}
${bestDuration ? `\nBest performing length: ${bestDuration.bucket} (${bestDuration.medianViews.toLocaleString()} median views)` : ""}

Top topics: ${fingerprint.topicPerformance.slice(0, 4).map((t) => `${t.topic} (${t.lift}x)`).join(", ") || "n/a"}
Thumbnail style that fits: ${fingerprint.insights.thumbnailStyle}`;
}
