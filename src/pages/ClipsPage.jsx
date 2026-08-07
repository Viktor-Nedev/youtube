import { useState } from "react";
import { Link } from "react-router-dom";
import { Scissors, Download, FileVideo, Quote } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../lib/api.js";
import {
  Button,
  Card,
  PageTitle,
  SectionTitle,
  Badge,
  CopyButton,
  ErrorNote,
  EmptyState,
  RunningNote,
  formatDuration
} from "../components/ui.jsx";

/** Labelled segmented control — the editor has enough options to need one. */
function Segmented({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow text-ink-500">{label}</span>
      <div className="flex overflow-hidden rounded-lg border border-ink-700">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1.5 text-sm transition ${
              value === option.value ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:bg-ink-850"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ClipsPage() {
  const { project, patchProject, hasTranscript } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vertical, setVertical] = useState(true);
  const [withCaptions, setWithCaptions] = useState(true);
  // undefined means "let the content detector decide"
  const [fit, setFit] = useState(undefined);
  const [subtitleStyle, setSubtitleStyle] = useState("pop");
  const [subtitlePosition, setSubtitlePosition] = useState("bottom");
  const [subtitleAnimation, setSubtitleAnimation] = useState("pop");
  const [wordsPerCue, setWordsPerCue] = useState(1);
  const [accent, setAccent] = useState("#FFE01A");
  const [withEmoji, setWithEmoji] = useState(true);
  const [effects, setEffects] = useState({ zoom: true, punchIn: false, fadeEdges: true });

  const clips = project?.clips;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateClips(project.id, {
        vertical,
        withCaptions,
        fit,
        subtitleStyle,
        subtitlePosition,
        subtitleAnimation,
        wordsPerCue,
        accent,
        withEmoji,
        effects
      });
      patchProject({ clips: result });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!hasTranscript) {
    return (
      <EmptyState icon={FileVideo} title="No transcript yet">
        Upload a video on the <Link to="/app" className="text-accent underline underline-offset-2">Upload</Link> page.
        Clips are found in the transcript, then cut from the source file.
      </EmptyState>
    );
  }

  const duration = project.media?.durationSec ?? 1;

  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow="Step 04 — Repurposing"
        icon={Scissors}
        sub="Finds self-contained moments in the transcript and cuts them into real vertical clips with burned-in captions — ready to post."
        actions={
          <Button onClick={generate} disabled={loading}>
            {loading ? "Cutting…" : clips ? "Regenerate" : "Find & cut clips"}
          </Button>
        }
      >
        Shorts
      </PageTitle>

      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              checked={vertical}
              onChange={(e) => setVertical(e.target.checked)}
              className="accent-accent"
            />
            9:16 vertical
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              checked={withCaptions}
              onChange={(e) => setWithCaptions(e.target.checked)}
              className="accent-accent"
            />
            Word-by-word captions
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              checked={withEmoji}
              onChange={(e) => setWithEmoji(e.target.checked)}
              className="accent-accent"
            />
            Emoji
          </label>

          {vertical ? (
            <Segmented
              label="Framing"
              value={fit ?? "auto"}
              onChange={(v) => setFit(v === "auto" ? undefined : v)}
              options={[
                { value: "auto", label: "Auto" },
                { value: "crop", label: "Crop" },
                { value: "pad", label: "Fit" }
              ]}
            />
          ) : null}
        </div>

        {withCaptions ? (
          <>
            <div className="rule" />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <Segmented
                label="Style"
                value={subtitleStyle}
                onChange={setSubtitleStyle}
                options={[
                  { value: "pop", label: "Pop" },
                  { value: "karaoke", label: "Karaoke" },
                  { value: "box", label: "Box" },
                  { value: "typewriter", label: "Typewriter" }
                ]}
              />
              <Segmented
                label="Position"
                value={subtitlePosition}
                onChange={setSubtitlePosition}
                options={[
                  { value: "top", label: "Top" },
                  { value: "middle", label: "Middle" },
                  { value: "bottom", label: "Bottom" }
                ]}
              />
              <Segmented
                label="Animation"
                value={subtitleAnimation}
                onChange={setSubtitleAnimation}
                options={[
                  { value: "pop", label: "Pop" },
                  { value: "fade", label: "Fade" },
                  { value: "slide", label: "Slide" },
                  { value: "none", label: "None" }
                ]}
              />
              {subtitleStyle === "pop" || subtitleStyle === "box" ? (
                <Segmented
                  label="Words"
                  value={String(wordsPerCue)}
                  onChange={(v) => setWordsPerCue(Number(v))}
                  options={[
                    { value: "1", label: "One" },
                    { value: "2", label: "Two" }
                  ]}
                />
              ) : null}
              <div className="flex items-center gap-2">
                <span className="eyebrow text-ink-500">Colour</span>
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded-md border border-ink-700 bg-ink-900"
                />
              </div>
            </div>
          </>
        ) : null}

        <div className="rule" />
        <div className="flex flex-wrap items-center gap-6">
          <span className="eyebrow text-ink-500">Effects</span>
          {[
            { key: "zoom", label: "Slow zoom" },
            { key: "punchIn", label: "Punch in on hook" },
            { key: "fadeEdges", label: "Fade edges" }
          ].map((effect) => (
            <label key={effect.key} className="flex cursor-pointer items-center gap-2 text-sm text-ink-300">
              <input
                type="checkbox"
                checked={effects[effect.key]}
                onChange={(e) => setEffects({ ...effects, [effect.key]: e.target.checked })}
                className="accent-accent"
              />
              {effect.label}
            </label>
          ))}
        </div>
      </Card>

      <p className="-mt-4 text-xs text-ink-500">
        {fit === undefined
          ? "Auto inspects the footage and fits screen recordings whole while cropping to a centred subject."
          : fit === "crop"
            ? "Crop centre-fills the frame. Right for a talking head; it slices the sides off a screen recording."
            : "Fit keeps the entire frame visible over a blurred backdrop — for screen recordings and slides."}
      </p>

      {loading ? (
        <RunningNote label="Finding highlight moments, then encoding each clip with ffmpeg — this takes a moment…" />
      ) : null}
      <ErrorNote error={error} onRetry={generate} />

      {clips?.clips?.length ? (
        <div className="space-y-8 fade-up">
          {clips.contentType ? (
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <Badge tone="accent">
                {clips.contentType.type === "screen"
                  ? "Screen recording detected"
                  : clips.contentType.type === "camera"
                    ? "Camera footage detected"
                    : "Mixed footage detected"}
              </Badge>
              <Badge>{clips.fit === "pad" ? "fit whole frame" : "centre crop"}</Badge>
              <span className="text-sm text-ink-400">{clips.contentType.reason}</span>
            </Card>
          ) : null}

          <section>
            <SectionTitle hint={`${clips.clips.length} clips in ${(clips.elapsedMs / 1000).toFixed(1)}s`}>
              Where they came from
            </SectionTitle>
            <Card className="p-5">
              {/* Timeline showing each clip's position within the source video. */}
              <div className="relative h-10 overflow-hidden rounded-lg bg-ink-800">
                {clips.clips.map((clip) => (
                  <div
                    key={clip.index}
                    className="absolute top-0 h-full border-x border-ink-950/50 bg-accent/70"
                    style={{
                      left: `${(clip.startSec / duration) * 100}%`,
                      width: `${Math.max(((clip.endSec - clip.startSec) / duration) * 100, 0.8)}%`
                    }}
                    title={clip.title}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-ink-500">
                <span>0:00</span>
                <span>{formatDuration(duration)}</span>
              </div>
            </Card>
          </section>

          <section className="grid gap-5 md:grid-cols-2">
            {clips.clips.map((clip) => (
              <Card key={clip.index} className="overflow-hidden">
                <video
                  src={clip.url}
                  controls
                  preload="metadata"
                  className="max-h-[420px] w-full bg-black object-contain"
                />
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-medium text-ink-200">{clip.title}</h3>
                    <a href={clip.url} download>
                      <Button variant="ghost" size="sm">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge tone="accent">{clip.durationSec}s</Badge>
                    <Badge>
                      {clip.startLabel} → {clip.endLabel}
                    </Badge>
                    {clip.wordCount ? (
                      <Badge tone={clip.timingSource === "model" ? "good" : "neutral"}>
                        {clip.wordCount} words · {clip.timingSource === "model" ? "timed" : "estimated"}
                      </Badge>
                    ) : null}
                    {clip.emoji ? <Badge>{clip.emoji}</Badge> : null}
                  </div>

                  <div className="rounded-lg border border-ink-800 bg-ink-900 p-3">
                    <p className="mb-1 flex items-center gap-1.5 text-xs text-ink-500">
                      <Quote className="h-3 w-3" />
                      Hook
                    </p>
                    <p className="text-sm text-ink-300">{clip.hook}</p>
                  </div>

                  <p className="text-sm text-ink-400">{clip.reason}</p>

                  <div className="flex items-start justify-between gap-2 border-t border-ink-800 pt-3">
                    <p className="text-sm text-ink-300">{clip.caption}</p>
                    <CopyButton value={clip.caption} />
                  </div>
                </div>
              </Card>
            ))}
          </section>
        </div>
      ) : null}
    </div>
  );
}
