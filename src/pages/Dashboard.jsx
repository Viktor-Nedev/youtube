import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, FileVideo, Clock, Languages, AlertTriangle } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { uploadVideo, api } from "../lib/api.js";
import {
  Button,
  Card,
  PageTitle,
  SectionTitle,
  Badge,
  ErrorNote,
  formatDuration
} from "../components/ui.jsx";

export default function Dashboard() {
  const { project, setProject, projects, refreshProjects, health, fingerprint } = useApp();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    setProgress(0);
    setStage("Uploading");

    try {
      const result = await uploadVideo(file, (pct) => {
        setProgress(pct);
        // The request stays open while the server extracts audio and transcribes,
        // so once bytes are delivered we switch the label rather than sit at 100%.
        if (pct >= 100) setStage("Extracting audio and transcribing with Gemini");
      });
      setProject(result.project);
      await refreshProjects();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setStage("");
    }
  };

  const selectProject = async (id) => {
    try {
      const res = await api.getProject(id);
      setProject(res.project);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-10">
      <PageTitle
        eyebrow="Step 01 — Ingest"
        sub="Upload once. The transcript is shared by every module — metadata, thumbnails, Shorts — so you never process the same video twice."
      >
        Upload a video
      </PageTitle>

      {health && !health.gemini ? (
        <div className="flex items-start gap-3 rounded-lg border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">GEMINI_API_KEY is not configured</p>
            <p className="mt-0.5 text-signal/80">
              Add it to <code className="rounded bg-ink-900 px-1">.env</code> and restart. Get one free
              at aistudio.google.com/apikey
            </p>
          </div>
        </div>
      ) : null}

      <section>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition ${
            dragging ? "border-accent bg-accent/5" : "border-ink-700 hover:border-ink-600 hover:bg-ink-900/50"
          } ${uploading ? "pointer-events-none opacity-70" : ""}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <Upload className="mx-auto mb-4 h-8 w-8 text-ink-500" />
          <p className="font-medium text-ink-200">Drop a video here, or click to browse</p>
          <p className="mt-1 text-sm text-ink-400">MP4, MOV, MKV, WebM or an audio file — up to 800MB</p>
        </div>

        {uploading ? (
          <Card className="mt-4 p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-ink-300">{stage}</span>
              <span className="text-ink-400">{progress < 100 ? `${progress}%` : ""}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className={`h-full rounded-full bg-accent transition-all ${progress >= 100 ? "animate-pulse" : ""}`}
                style={{ width: `${Math.max(progress, 4)}%` }}
              />
            </div>
            {progress >= 100 ? (
              <p className="mt-2 text-xs text-ink-500">
                Transcription runs at roughly real-time ÷ 20 — a 10-minute video takes about 30 seconds.
              </p>
            ) : null}
          </Card>
        ) : null}

        <div className="mt-4">
          <ErrorNote error={error} />
        </div>
      </section>

      {project ? (
        <section className="fade-up">
          <SectionTitle hint={project.transcript ? `${project.transcript.segments.length} segments` : null}>
            Active video
          </SectionTitle>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileVideo className="h-4 w-4 text-accent" />
                  <h3 className="truncate font-medium text-ink-200">{project.originalName}</h3>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(project.media?.durationSec)}
                  </span>
                  <span>
                    {project.media?.width}×{project.media?.height}
                  </span>
                  {project.transcript ? (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <Languages className="h-3.5 w-3.5" />
                        {project.transcript.language}
                      </span>
                      <span>{project.transcript.wordCount} words</span>
                      <Badge tone="good">transcribed in {(project.transcript.elapsedMs / 1000).toFixed(1)}s</Badge>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => navigate("/app/metadata")}>
                  Generate metadata
                </Button>
                <Button size="sm" onClick={() => navigate("/app/thumbnail")}>
                  Make thumbnail
                </Button>
              </div>
            </div>

            {project.transcript ? (
              <>
                <p className="mt-4 border-t border-ink-800 pt-4 text-sm text-ink-300">
                  {project.transcript.summary}
                </p>
                {project.transcript.topics?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {project.transcript.topics.map((topic) => (
                      <Badge key={topic}>{topic}</Badge>
                    ))}
                  </div>
                ) : null}

                <details className="mt-4 border-t border-ink-800 pt-4">
                  <summary className="cursor-pointer text-sm text-ink-400 hover:text-ink-300">
                    View full transcript
                  </summary>
                  <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-2">
                    {project.transcript.segments.map((segment, index) => (
                      <div key={index} className="flex gap-3 text-sm">
                        <span className="shrink-0 font-mono text-xs text-ink-500">
                          {formatDuration(segment.start)}
                        </span>
                        <span className="text-ink-300">{segment.text}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            ) : null}
          </Card>
        </section>
      ) : null}

      {!fingerprint ? (
        <section>
          <Card className="flex flex-wrap items-center justify-between gap-4 border-accent/25 bg-accent/5 p-5">
            <div>
              <h3 className="font-medium text-ink-200">Connect a channel to sharpen every result</h3>
              <p className="mt-1 max-w-xl text-sm text-ink-400">
                Without a channel, output follows generic SEO best practice. With one, it follows what
                measurably works on that channel.
              </p>
            </div>
            <Button onClick={() => navigate("/app/channel")}>Build fingerprint</Button>
          </Card>
        </section>
      ) : null}

      {projects.length > 1 ? (
        <section>
          <SectionTitle>Previous uploads</SectionTitle>
          <div className="grid gap-2">
            {projects
              .filter((p) => p.id !== project?.id)
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectProject(p.id)}
                  className="flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900 px-4 py-3 text-left transition hover:border-ink-700 hover:bg-ink-850"
                >
                  <span className="truncate text-sm text-ink-300">{p.originalName}</span>
                  <span className="ml-4 shrink-0 text-xs text-ink-500">{p.durationLabel}</span>
                </button>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
