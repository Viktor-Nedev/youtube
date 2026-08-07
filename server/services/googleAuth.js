import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "../store.js";

/**
 * Google OAuth 2.0 for uploading to the creator's own channel.
 *
 * Read-only YouTube data needs no login, which is why the rest of the app uses
 * a plain API key. Uploading is different: `videos.insert` writes to a channel,
 * so it requires the user's consent and an access token.
 *
 * `youtube.upload` is a sensitive scope. Without Google verification it works
 * only for accounts added as test users on the consent screen, which is fine
 * for a creator running this locally on their own channel.
 */

const TOKEN_FILE = path.join(DATA_DIR, "google-tokens.json");

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly"
];

export function oauthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:8787/api/auth/callback"
  };
}

export function isConfigured() {
  const { clientId, clientSecret } = oauthConfig();
  return Boolean(clientId && clientSecret);
}

function requireConfig() {
  const config = oauthConfig();
  if (!config.clientId || !config.clientSecret) {
    throw Object.assign(
      new Error(
        "Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env — create them in Google Cloud Console under Credentials > OAuth client ID > Web application."
      ),
      { status: 503 }
    );
  }
  return config;
}

/* ---------- token storage ---------- */

function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf8");
}

export function clearTokens() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {
    /* already gone */
  }
}

export function isConnected() {
  return Boolean(readTokens()?.refresh_token);
}

/* ---------- the flow ---------- */

// Short-lived CSRF state values, keyed by the value we handed to Google.
const pendingStates = new Map();

export function buildAuthUrl() {
  const { clientId, redirectUri } = requireConfig();
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  // Needed to get a refresh token: without both, Google only returns one on the
  // very first consent and the connection silently dies after an hour.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeCode(code, state) {
  const { clientId, clientSecret, redirectUri } = requireConfig();

  if (!pendingStates.has(state)) {
    throw Object.assign(new Error("Invalid or expired OAuth state."), { status: 400 });
  }
  pendingStates.delete(state);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  const tokens = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(`Token exchange failed: ${tokens.error_description || tokens.error}`), {
      status: 400
    });
  }

  writeTokens({ ...tokens, obtained_at: Date.now() });
  return tokens;
}

/**
 * Returns a valid access token, refreshing it when it has expired.
 * Access tokens last an hour, so anything but the shortest session needs this.
 */
export async function getAccessToken() {
  const { clientId, clientSecret } = requireConfig();
  const tokens = readTokens();

  if (!tokens?.refresh_token) {
    throw Object.assign(new Error("Not connected to YouTube. Authorise the app first."), { status: 401 });
  }

  const expiresAt = (tokens.obtained_at ?? 0) + (tokens.expires_in ?? 3600) * 1000;
  // Refresh a minute early rather than racing the expiry.
  if (tokens.access_token && Date.now() < expiresAt - 60_000) {
    return tokens.access_token;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token"
    })
  });

  const refreshed = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(`Token refresh failed: ${refreshed.error_description || refreshed.error}`), {
      status: 401
    });
  }

  // A refresh response omits refresh_token, so the original must be kept.
  writeTokens({ ...tokens, ...refreshed, obtained_at: Date.now() });
  return refreshed.access_token;
}

export { SCOPES };
