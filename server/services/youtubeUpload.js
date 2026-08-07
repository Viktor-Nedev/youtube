import fs from "node:fs";
import { getAccessToken } from "./googleAuth.js";

/**
 * Uploads to the creator's channel, optionally scheduled.
 *
 * Scheduling is not a separate API — YouTube schedules a video by accepting it
 * as `private` with a `publishAt` timestamp, and flipping it public itself at
 * that moment. So a scheduled post and an immediate one differ only in the
 * status block.
 *
 * Resumable upload is used rather than a single multipart POST because clips
 * and full videos are large enough that a dropped connection mid-upload would
 * otherwise mean starting over.
 */

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

/**
 * @param {object} options
 * @param {string} options.filePath        Video to upload
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {string[]} [options.tags]
 * @param {"public"|"private"|"unlisted"} [options.privacyStatus]
 * @param {string} [options.publishAt]     ISO 8601; forces privacyStatus to private
 * @param {string} [options.categoryId]    22 = People & Blogs
 * @param {boolean} [options.madeForKids]
 * @param {(pct:number)=>void} [options.onProgress]
 */
export async function uploadVideo({
  filePath,
  title,
  description = "",
  tags = [],
  privacyStatus = "private",
  publishAt = null,
  categoryId = "22",
  madeForKids = false,
  onProgress
}) {
  const accessToken = await getAccessToken();
  const { size } = await fs.promises.stat(filePath);

  // A publishAt on anything but a private video is rejected by the API.
  const status = {
    privacyStatus: publishAt ? "private" : privacyStatus,
    selfDeclaredMadeForKids: madeForKids
  };
  if (publishAt) status.publishAt = new Date(publishAt).toISOString();

  const metadata = {
    snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), tags, categoryId },
    status
  };

  // Step 1 — open a resumable session and get the URL to push bytes to.
  const initResponse = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": "video/*"
    },
    body: JSON.stringify(metadata)
  });

  if (!initResponse.ok) {
    const body = await initResponse.text();
    throw Object.assign(new Error(`Could not start upload: ${body.slice(0, 300)}`), {
      status: initResponse.status
    });
  }

  const sessionUrl = initResponse.headers.get("location");
  if (!sessionUrl) {
    throw new Error("YouTube did not return an upload session URL.");
  }

  // Step 2 — send the file. Node streams the body, and progress is reported
  // from the read side so a long upload isn't silent.
  let sent = 0;
  const stream = fs.createReadStream(filePath);
  stream.on("data", (chunk) => {
    sent += chunk.length;
    onProgress?.(Math.round((sent / size) * 100));
  });

  const uploadResponse = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Length": String(size), "Content-Type": "video/*" },
    body: stream,
    duplex: "half"
  });

  const result = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    throw Object.assign(
      new Error(`Upload failed: ${result?.error?.message || uploadResponse.statusText}`),
      { status: uploadResponse.status }
    );
  }

  return {
    videoId: result.id,
    url: `https://www.youtube.com/watch?v=${result.id}`,
    studioUrl: `https://studio.youtube.com/video/${result.id}/edit`,
    privacyStatus: result.status?.privacyStatus,
    publishAt: result.status?.publishAt ?? null,
    title: result.snippet?.title
  };
}

/** The channel the stored credentials belong to, for showing who is connected. */
export async function getMyChannel() {
  const accessToken = await getAccessToken();
  const response = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message || "Could not read channel"), {
      status: response.status
    });
  }

  const channel = data.items?.[0];
  if (!channel) throw Object.assign(new Error("This Google account has no YouTube channel."), { status: 404 });

  return {
    id: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails?.default?.url,
    subscribers: Number(channel.statistics?.subscriberCount || 0)
  };
}
