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

export default function ClipsPage() {
  const { project, patchProject, hasTranscript } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vertical, setVertical] = useState(true);
  const [withCaptions, setWithCaptions] = useState(true);

  const clips = project?.clips;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateClips(project.id, { vertical, withCaptions });
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

      <Card className="flex flex-wrap gap-6 p-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={vertical}
            onChange={(e) => setVertical(e.target.checked)}
            className="accent-accent"
          />
          Reframe to 9:16 vertical
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={withCaptions}
            onChange={(e) => setWithCaptions(e.target.checked)}
            className="accent-accent"
          />
          Burn in captions
        </label>
      </Card>

      {loading ? (
        <RunningNote label="Finding highlight moments, then encoding each clip with ffmpeg — this takes a moment…" />
      ) : null}
      <ErrorNote error={error} onRetry={generate} />

      {clips?.clips?.length ? (
        <div className="space-y-8 fade-up">
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
                    {clip.captionCount ? <Badge>{clip.captionCount} captions</Badge> : null}
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
