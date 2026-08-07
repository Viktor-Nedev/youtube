# YouTube Creator Copilot

**One dashboard that automates the YouTube creator pipeline — conditioned on what actually works for your channel.**

Built for the [YouTube Automation Hackathon](https://youtube-automate-hackathon.devpost.com/).

---

## The problem

Creator tooling is a pile of disconnected single-purpose apps. One writes titles, another cuts clips, another picks thumbnails. You re-upload the same video to each one, and every one of them gives you the same generic advice it gives everybody else — *"use numbers in your title," "add a face to your thumbnail."*

That advice ignores the only data that actually matters: **what already worked on your channel.**

A cooking channel where question-titles get 2× the views and a tech channel where they flop both get told to use question-titles. The tools have the performance data available and don't use it.

## The idea: a Channel Fingerprint

Creator Copilot analyses a channel's real published performance *first*, and derives a profile of what measurably drives views **there** — which title structures outperform, which video lengths win, which topics land.

That profile is then injected into the prompt of every generation module. The result isn't "here are 5 SEO titles," it's:

> *"Your question-format titles pull 2.3× your median views across 7 videos — so here are question titles."*

Upload one video, and six modules share both that video's transcript and the channel profile. That shared context is what makes this one product instead of six scripts.

---

## The six modules

| Module | What it does |
|---|---|
| **Ingest & Transcript** | Extracts audio with ffmpeg, transcribes it with Gemini into timestamped segments. Every other module reads from this — you never process the same video twice. |
| **Channel Fingerprint** | Fetches a channel's recent uploads, has Gemini label each title's structure, then **computes lift arithmetically in code**. Produces the profile that conditions everything else. |
| **Metadata** | 5 titles (each with a rationale tied to a fingerprint pattern), description, 15–20 tags, chapters snapped to real topic changes, and a pinned comment. |
| **Thumbnail** | Samples frames, scores each locally, sends only the best 8 to Gemini vision, then renders a finished 1280×720 PNG with a composited text overlay. Runs in two phases so the scored candidate grid appears in ~13s, while the vision call is still in flight. |
| **Shorts** | A short-form editor, not just a cutter. Finds self-contained moments, cuts **real 9:16 vertical MP4s**, and burns in **word-by-word captions** in four styles (pop, karaoke highlight, accent box, typewriter) with selectable position, entry animation, colour and colour emoji. Adds slow zoom, punch-in and edge fades. Framing is chosen automatically from the footage. |
| **Schedule** | Uploads finished videos and Shorts to your own channel, immediately or on a calendar slot. |
| **Analytics** | Every upload plotted against the channel's own median, with underperformers diagnosed and given rewritten titles. |
| **Comments** | Sorts a comment section into spam / toxic / questions / praise / criticism and drafts replies for the ones worth your time. |

---

## Two engineering decisions worth calling out

### 1. The model labels; the code computes

An LLM asked to calculate "2.3× lift" will produce a confident, plausible, **wrong** number. So the work is split:

- **Gemini** does semantics — is this title a question? a listicle? what topic is it?
- **`services/fingerprint.js`** does arithmetic — every median, ratio and lift is computed in JavaScript from the statistics the YouTube API returned.

Lift is only reported when at least 3 videos sit on each side of the split, and videos newer than 14 days are excluded from pattern analysis because they haven't accumulated their views yet. Every number in the UI is reproducible from the raw data.

Verified rather than asserted: recomputing every lift figure independently from the returned view counts reproduces the displayed values exactly.

One honest caveat — the *labelling* is not deterministic. Re-analysing the same channel can move a borderline feature's lift, because the model re-reads each title and marginal judgements shift. The arithmetic is exact for whatever labels a run produced; the labels themselves carry model variance. Fingerprints are cached on disk, so a given profile stays stable until you explicitly refresh it.

### 2. Staying inside the YouTube API's terms

`captions.download` is **owner-only** — the API does not permit downloading captions for videos you don't own, at any authorization level. Rather than scrape the timedtext endpoint (which would violate the API terms this hackathon asks entrants to respect), transcript features run on **files you upload**, and Gemini transcribes them directly.

Everything else — channel stats, video statistics, comments — uses public read-only endpoints, which is also why **no OAuth or login is required**.

Quota is treated as a real budget. `search.list` costs 100 units against a 10,000/day allowance, so it is never called; a channel's uploads are reached via `channels.list → contentDetails.relatedPlaylists.uploads → playlistItems.list` instead. **A full 50-video fingerprint costs about 5 units.**

---

## Tech stack

**Frontend** — React 19, Vite 7, Tailwind CSS 4, Recharts, GSAP + ScrollTrigger, Lenis, Lucide

**Backend** — Node 22, Express 5, Multer

**AI** — Google Gemini (`@google/genai`)
- `gemini-3.6-flash` — transcription (audio), vision (thumbnails), and all generation
- `gemini-3.5-flash-lite` — high-volume comment classification

Every AI call goes through one wrapper (`server/services/gemini.js`) and uses **schema-enforced JSON output** — no regex-parsing of model prose, with retry and exponential backoff on transient failures.

**Media** — `ffmpeg-static` + `ffprobe-static` (bundled binaries, no system install), `sharp` for frame scoring and image compositing

**Data** — YouTube Data API v3, public endpoints only

### Captions are ASS, and emoji are not

Captions are generated as ASS subtitle files and burned in with libass, which the
bundled ffmpeg supports along with freetype, harfbuzz and fribidi. At one word per cue
a 30-second clip needs around a hundred cues — as image overlays that would be
unworkable, while ASS gives timing, styling, positioning and animation natively.

Word timing comes from a pass over each clip's own audio rather than the whole video,
which is markedly more accurate, and falls back to character-weighted distribution so a
poor response degrades instead of breaking rendering.

Colour emoji are the exception. **libass renders emoji as monochrome glyphs** because it
does not rasterise colour font layers — verified by rendering, not assumed — so emoji are
composited separately as bundled Twemoji PNGs. The model may only choose from the 36
shipped glyphs, so it can never name one that cannot be drawn.

### Framing is detected, not configured

Centre-cropping to 9:16 is right for a person on camera and destructive for a screen
recording: it keeps roughly 600px of a 1920px-wide frame, slicing a slide or webpage into
something unreadable. Rather than leave a toggle a creator has to know to flip, three
frames are classified once and the sensible default is chosen — fit-to-frame for screen
recordings, centre crop for centred camera footage. Manual override is still available.

### Notable non-choices

- **`fluent-ffmpeg`** — archived May 2025 and broken with current ffmpeg. Binaries are invoked directly via `execFile`.
- **TensorFlow.js / MediaPipe** for face detection — needs native `node-gyp` builds that routinely fail on Windows, to score something Gemini vision judges better anyway. Replaced with a cheap `sharp` pre-filter (Laplacian-variance sharpness, Hasler–Süsstrunk colourfulness, exposure, plus dHash de-duplication) that narrows ~100 frames to 8, so the module spends exactly **one** vision call.
- **`node-canvas`** for text overlay — another Windows native-build trap. Text is composited as an SVG layer through `sharp`.
- **Whisper** — unnecessary. Gemini transcribes audio natively, so the project needs one AI provider instead of two.

---

## Running it

**Requirements:** Node 18+ (developed on 22). ffmpeg is **not** required — binaries ship with the dependencies.

```bash
npm install
cp .env.example .env    # then add your keys
npm run dev
```

Open **http://localhost:5173**. The Express API runs on `:8787` and Vite proxies `/api` and `/files` to it.

### Environment variables

| Variable | Required | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | Yes — all AI modules | [aistudio.google.com/apikey](https://aistudio.google.com/apikey), free tier available |
| `YOUTUBE_API_KEY` | For Fingerprint / Analytics / Comments | Google Cloud Console → enable **YouTube Data API v3** → Credentials → API key. No OAuth consent screen needed. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Only for uploading & scheduling | Google Cloud Console → Credentials → OAuth client ID → **Web application**, redirect URI `http://localhost:8787/api/auth/callback` |
| `PORT` | No | Defaults to `8787` |

Everything except the Schedule module is read-only and needs no login. Uploading writes to
a channel, so it requires OAuth consent. `youtube.upload` is a sensitive scope: until an
app is verified by Google it works only for accounts added as **test users** on the consent
screen — which is all a creator needs for their own channel.

The Upload and Thumbnail modules work with only `GEMINI_API_KEY`. The channel modules need `YOUTUBE_API_KEY` as well.

### Try it in 60 seconds

1. **Channel Fingerprint** → enter any public channel handle (e.g. `@mkbhd`) → *Analyse channel*
2. **Upload** → drop in a short video → transcript appears
3. **Metadata** → *Generate* → note each title's rationale citing a real pattern from step 1
4. **Thumbnail** → *Generate* → candidate grid with scores, then a downloadable PNG
5. **Shorts** → *Find & cut clips* → real vertical MP4s with captions

---

## Project layout

```
server/
  services/
    gemini.js       Single AI entry point — schema-enforced JSON, retries, audio/image parts
    ffmpeg.js       Audio extraction, frame sampling, clip cutting with overlay filters
    frameScore.js   Local frame quality scoring + perceptual-hash de-duplication
    youtube.js      Data API v3 client, quota-conscious by construction
    fingerprint.js  THE SPINE — builds the channel profile, computes all statistics
  routes/           ingest · channel · metadata · thumbnail · clips · comments
  store.js          Session state + disk-cached fingerprints
src/
  pages/            Landing (scroll-scrubbed hero) + six module pages
  context/          Shared video + fingerprint state
  components/       UI primitives and validated chart configuration
```

Chart colours were validated against this app's dark surface for colour-vision-deficiency separation and contrast rather than picked by eye.

---

## Team

Solo project — **Viktor** ([@viktornedev08](https://github.com/viktornedev08)). Everything in this repository: architecture, backend, frontend, prompt design.

---

## Licence

MIT
