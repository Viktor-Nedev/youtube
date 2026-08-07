/**
 * YouTube Data API v3 client — public data only, no OAuth.
 *
 * Quota discipline is the whole design here. The free budget is 10,000 units/day
 * and `search.list` costs 100 units per call, while `channels.list`,
 * `playlistItems.list`, `videos.list` and `commentThreads.list` cost 1 unit each.
 * We therefore never call search: a channel's uploads are reached via
 * channels.list -> contentDetails.relatedPlaylists.uploads -> playlistItems.list.
 * A full 50-video fingerprint costs about 5 units.
 */

const API = "https://www.googleapis.com/youtube/v3";

// Rough local accounting so the UI can show what a run actually cost.
let unitsUsed = 0;
export const getQuotaUsed = () => unitsUsed;
export const resetQuota = () => {
  unitsUsed = 0;
};

function apiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw Object.assign(
      new Error(
        "YOUTUBE_API_KEY is not set. Create one in Google Cloud Console (enable 'YouTube Data API v3' > Credentials > API key) and add it to .env"
      ),
      { status: 500 }
    );
  }
  return key;
}

async function call(endpoint, params, cost = 1) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set("key", apiKey());

  const response = await fetch(url);
  unitsUsed += cost;

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason;
    // Google embeds anchor tags and <code> in error text; strip it so the UI
    // shows a sentence rather than raw markup.
    const message = String(body?.error?.message || response.statusText)
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (reason === "quotaExceeded") {
      throw Object.assign(new Error("YouTube API daily quota exceeded. It resets at midnight Pacific time."), {
        status: 429
      });
    }
    if (reason === "videoNotFound") {
      throw Object.assign(new Error("That video doesn't exist, or it isn't public."), { status: 404 });
    }
    if (reason === "commentsDisabled") {
      throw Object.assign(new Error("Comments are disabled on that video."), { status: 400 });
    }

    throw Object.assign(new Error(`YouTube API (${endpoint}): ${message}`), { status: response.status });
  }

  return response.json();
}

/** ISO-8601 duration ("PT4M13S") -> seconds. */
export function parseDuration(iso) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!match) return 0;
  const [, d, h, m, s] = match.map((v) => (v ? Number(v) : 0));
  return d * 86400 + h * 3600 + m * 60 + s;
}

/**
 * Accepts a handle (@name), channel URL, or raw channel ID (UC...).
 *
 * Legacy /c/custom URLs are not resolvable without search.list (100 units), so
 * we ask the user for a handle instead of silently burning 1% of the daily quota.
 */
export function parseChannelInput(input) {
  const value = String(input || "").trim();
  if (!value) throw Object.assign(new Error("Provide a channel handle, URL or ID"), { status: 400 });

  if (/^UC[\w-]{20,}$/.test(value)) return { type: "id", value };
  if (/^@[\w.\-]+$/.test(value)) return { type: "handle", value };

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    const parts = url.pathname.split("/").filter(Boolean);

    const handlePart = parts.find((p) => p.startsWith("@"));
    if (handlePart) return { type: "handle", value: handlePart };

    const channelIndex = parts.indexOf("channel");
    if (channelIndex !== -1 && parts[channelIndex + 1]) {
      return { type: "id", value: parts[channelIndex + 1] };
    }

    if (parts[0] === "c" || parts[0] === "user") {
      throw Object.assign(
        new Error(
          `Legacy /${parts[0]}/ URLs can't be resolved cheaply. Open the channel on YouTube and use its @handle instead.`
        ),
        { status: 400 }
      );
    }
  } catch (error) {
    if (error.status) throw error;
  }

  // Bare word: treat as a handle.
  return { type: "handle", value: value.startsWith("@") ? value : `@${value}` };
}

/** Channel metadata + the uploads playlist id we need to list its videos. */
export async function getChannel(input) {
  const parsed = parseChannelInput(input);
  const params = {
    part: "snippet,contentDetails,statistics",
    ...(parsed.type === "id" ? { id: parsed.value } : { forHandle: parsed.value })
  };

  const data = await call("channels", params);
  const channel = data.items?.[0];
  if (!channel) {
    throw Object.assign(new Error(`No YouTube channel found for "${input}"`), { status: 404 });
  }

  return {
    id: channel.id,
    title: channel.snippet.title,
    description: channel.snippet.description,
    customUrl: channel.snippet.customUrl,
    thumbnail: channel.snippet.thumbnails?.medium?.url,
    publishedAt: channel.snippet.publishedAt,
    subscribers: Number(channel.statistics.subscriberCount || 0),
    totalViews: Number(channel.statistics.viewCount || 0),
    videoCount: Number(channel.statistics.videoCount || 0),
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads
  };
}

/** Video ids from the uploads playlist, newest first. 1 unit per 50. */
export async function getUploadIds(uploadsPlaylistId, limit = 50) {
  const ids = [];
  let pageToken;

  while (ids.length < limit) {
    const data = await call("playlistItems", {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(50, limit - ids.length),
      pageToken
    });
    ids.push(...data.items.map((item) => item.contentDetails.videoId));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return ids.slice(0, limit);
}

/** Full stats for up to 50 video ids per call (1 unit per batch). */
export async function getVideos(videoIds) {
  const results = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const data = await call("videos", {
      part: "snippet,statistics,contentDetails",
      id: batch.join(",")
    });

    for (const item of data.items) {
      results.push({
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url,
        tags: item.snippet.tags || [],
        durationSec: parseDuration(item.contentDetails.duration),
        views: Number(item.statistics.viewCount || 0),
        likes: Number(item.statistics.likeCount || 0),
        comments: Number(item.statistics.commentCount || 0)
      });
    }
  }

  return results;
}

/**
 * Top-level comments for a video, paginated. 1 quota unit per page of up to 100,
 * so even 500 comments costs 5 units against the 10,000/day budget.
 */
export async function getComments(videoId, limit = 50) {
  const comments = [];
  let pageToken;

  while (comments.length < limit) {
    const data = await call("commentThreads", {
      part: "snippet",
      videoId,
      maxResults: Math.min(100, limit - comments.length),
      order: "relevance",
      textFormat: "plainText",
      pageToken
    });

    for (const item of data.items) {
      const comment = item.snippet.topLevelComment.snippet;
      comments.push({
        id: item.id,
        author: comment.authorDisplayName,
        authorImage: comment.authorProfileImageUrl,
        text: comment.textDisplay,
        likes: Number(comment.likeCount || 0),
        publishedAt: comment.publishedAt,
        replyCount: Number(item.snippet.totalReplyCount || 0)
      });
    }

    pageToken = data.nextPageToken;
    // Ran out of comments before reaching the requested limit.
    if (!pageToken || !data.items.length) break;
  }

  return comments.slice(0, limit);
}

/** Extracts a video id from a watch URL, youtu.be link, or bare id. */
export function parseVideoId(input) {
  const value = String(input || "").trim();
  if (/^[\w-]{11}$/.test(value)) return value;

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1, 12);
    const v = url.searchParams.get("v");
    if (v) return v;
    const shorts = url.pathname.match(/\/shorts\/([\w-]{11})/);
    if (shorts) return shorts[1];
  } catch {
    /* fall through */
  }

  throw Object.assign(new Error(`Could not read a video ID from "${input}"`), { status: 400 });
}
