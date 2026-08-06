import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Image as ImageIcon, Download, Sparkles, FileVideo, Trophy } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../lib/api.js";
import {
  Button,
  Card,
  PageTitle,
  SectionTitle,
  Badge,
  ErrorNote,
  EmptyState,
  RunningNote,
  Spinner
} from "../components/ui.jsx";

export default function ThumbnailPage() {
  const { project, patchProject, fingerprint } = useApp();
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rerendering, setRerendering] = useState(false);
  const [error, setError] = useState(null);
  const [text, setText] = useState("");
  const [position, setPosition] = useState("left");
  const [accent, setAccent] = useState("#FFE01A");

  const thumbnail = project?.thumbnail;

  useEffect(() => {
    if (thumbnail) {
      setText(thumbnail.overlayText ?? "");
      setPosition(thumbnail.textPosition ?? "left");
      setAccent(thumbnail.accentColor ?? "#FFE01A");
    }
  }, [thumbnail?.thumbnailUrl]);

  /**
   * Runs the two phases in sequence so the locally scored grid is on screen
   * while the vision call is still in flight — the local scoring step is a real
   * part of the pipeline and shouldn't be hidden inside one long spinner.
   */
  const generate = async () => {
    setLoading(true);
    setError(null);
    setPhase("frames");
    setPreview(null);
    try {
      const scored = await api.thumbnailFrames(project.id);
      setPreview(scored);
      setPhase("judging");

      const result = await api.thumbnailJudge(project.id);
      patchProject({ thumbnail: result.thumbnail });
      setPreview(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setPhase(null);
    }
  };

  const rerender = async () => {
    setRerendering(true);
    setError(null);
    try {
      const result = await api.renderThumbnail(project.id, { text, position, accent });
      patchProject({ thumbnail: { ...thumbnail, thumbnailUrl: result.thumbnailUrl, overlayText: text } });
    } catch (err) {
      setError(err.message);
    } finally {
      setRerendering(false);
    }
  };

  if (!project) {
    return (
      <EmptyState icon={FileVideo} title="No video uploaded yet">
        Upload a video on the <Link to="/app" className="text-accent underline underline-offset-2">Upload</Link> page first.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow="Step 03 — Packaging"
        icon={ImageIcon}
        sub="Every frame is scored locally for sharpness, colour and exposure. Only the best few reach Gemini vision, which judges click appeal and writes the overlay."
        actions={
          <Button onClick={generate} disabled={loading}>
            {loading ? "Analysing frames…" : thumbnail ? "Regenerate" : "Generate thumbnail"}
          </Button>
        }
      >
        Thumbnail
      </PageTitle>

      {fingerprint ? (
        <Badge tone="accent">
          <Sparkles className="h-3 w-3" />
          Styled to {fingerprint.channel.title}
        </Badge>
      ) : null}

      {loading ? (
        <RunningNote
          label={
            phase === "frames"
              ? "Extracting frames and scoring each one locally — sharpness, colour, exposure…"
              : "Frames scored. Sending the finalists to Gemini vision for click-appeal judgement…"
          }
        />
      ) : null}
      <ErrorNote error={error} onRetry={generate} />

      {/* Phase 1 output: real local scores, on screen while the AI is still thinking. */}
      {preview ? (
        <section className="fade-up">
          <SectionTitle hint={`${preview.framesSampled} frames sampled → ${preview.finalistCount} finalists in ${(preview.elapsedMs / 1000).toFixed(1)}s`}>
            Locally scored finalists
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {preview.candidates.map((candidate) => (
              <Card key={candidate.index} className="overflow-hidden">
                <div className="relative">
                  <img src={candidate.previewUrl} alt="" className="w-full" />
                  <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white">
                    {candidate.timeLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5">
                  <span className="tabular text-xs text-ink-400">local {candidate.localScore.toFixed(3)}</span>
                  <Spinner className="h-3 w-3 text-ink-600" />
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {thumbnail ? (
        <div className="space-y-8 fade-up">
          <section>
            <SectionTitle
              hint={`${thumbnail.framesSampled} frames sampled → ${thumbnail.finalistCount} finalists → 1 vision call`}
            >
              Final thumbnail
            </SectionTitle>
            <Card className="overflow-hidden">
              <img src={thumbnail.thumbnailUrl} alt="Generated thumbnail" className="w-full" />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 p-4">
                <p className="max-w-xl text-sm text-ink-400">{thumbnail.winnerReason}</p>
                <div className="flex gap-2">
                  <a href={thumbnail.cleanUrl} download>
                    <Button variant="ghost" size="sm">
                      Clean version
                    </Button>
                  </a>
                  <a href={thumbnail.thumbnailUrl} download>
                    <Button size="sm">
                      <Download className="h-3.5 w-3.5" />
                      Download PNG
                    </Button>
                  </a>
                </div>
              </div>
            </Card>
          </section>

          <section>
            <SectionTitle>Adjust the overlay</SectionTitle>
            <Card className="flex flex-wrap items-end gap-3 p-5">
              <div className="min-w-56 flex-1">
                <label className="mb-1.5 block text-xs text-ink-400">Text</label>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-ink-400">Position</label>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-accent focus:outline-none"
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-ink-400">Colour</label>
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-lg border border-ink-700 bg-ink-900"
                />
              </div>
              <Button variant="ghost" onClick={rerender} disabled={rerendering}>
                {rerendering ? "Rendering…" : "Re-render"}
              </Button>
            </Card>
            <p className="mt-2 text-xs text-ink-500">
              Re-rendering is local image compositing — no extra AI call, so iterate freely.
            </p>
          </section>

          <section>
            <SectionTitle hint="local score = sharpness · colour · contrast · exposure">
              Candidate frames
            </SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {thumbnail.candidates.map((candidate) => (
                <Card
                  key={candidate.index}
                  className={`overflow-hidden ${candidate.isWinner ? "border-accent" : ""}`}
                >
                  <div className="relative">
                    <img src={candidate.previewUrl} alt="" className="w-full" />
                    {candidate.isWinner ? (
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-white">
                        <Trophy className="h-3 w-3" />
                        Winner
                      </span>
                    ) : null}
                    <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white">
                      {candidate.timeLabel}
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="mb-2 flex items-center gap-2">
                      {candidate.aiScore != null ? (
                        <Badge tone={candidate.aiScore >= 7 ? "good" : candidate.aiScore >= 5 ? "signal" : "neutral"}>
                          AI {candidate.aiScore}/10
                        </Badge>
                      ) : null}
                      <span className="text-xs text-ink-500">local {candidate.localScore}</span>
                      {candidate.hasFace ? <Badge>{candidate.expression}</Badge> : null}
                    </div>
                    {candidate.reasoning ? (
                      <p className="text-xs leading-relaxed text-ink-400">{candidate.reasoning}</p>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
