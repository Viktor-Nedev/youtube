/**
 * Thin fetch wrapper. Every endpoint returns JSON and signals failure with a
 * non-2xx status plus an `error` string, so error handling lives in one place.
 */

async function handle(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

export async function get(path) {
  return handle(await fetch(`/api${path}`));
}

export async function post(path, body) {
  return handle(
    await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {})
    })
  );
}

/** Upload with progress, which fetch can't report — hence XHR. */
export function uploadVideo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("video", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/ingest");

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error("Server returned an unreadable response"));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new Error(payload.error || `Upload failed (${xhr.status})`));
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.send(form);
  });
}

export const api = {
  health: () => get("/health"),

  listProjects: () => get("/ingest"),
  getProject: (id) => get(`/ingest/${id}`),

  analyzeChannel: (channel, options = {}) => post("/channel/analyze", { channel, ...options }),
  activeChannel: () => get("/channel/active"),
  listChannels: () => get("/channel"),
  activateChannel: (channelId) => post("/channel/activate", { channelId }),

  generateMetadata: (projectId) => post(`/metadata/${projectId}`),
  generateThumbnail: (projectId) => post(`/thumbnail/${projectId}`),
  renderThumbnail: (projectId, options) => post(`/thumbnail/${projectId}/render`, options),
  generateClips: (projectId, options) => post(`/clips/${projectId}`, options),
  moderateComments: (video, limit) => post("/comments/moderate", { video, limit })
};
