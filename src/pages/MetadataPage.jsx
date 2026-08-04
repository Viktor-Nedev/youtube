import { useState } from "react";
import { Link } from "react-router-dom";
import { Tags, Sparkles, FileVideo } from "lucide-react";
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
  RunningNote
} from "../components/ui.jsx";

export default function MetadataPage() {
  const { project, patchProject, fingerprint, hasTranscript } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const metadata = project?.metadata;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateMetadata(project.id);
      patchProject({ metadata: result.metadata });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!hasTranscript) {
    return (
      <EmptyState icon={FileVideo} title="No video uploaded yet">
        Upload a video on the <Link to="/app" className="text-accent underline underline-offset-2">Upload</Link> page.
        Metadata is generated from its transcript.
      </EmptyState>
    );
  }

  const chaptersText = metadata?.chapters?.map((c) => `${c.timestamp} ${c.label}`).join("\n") ?? "";
  const fullDescription = metadata ? `${metadata.description}\n\n${chaptersText}` : "";

  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow="Step 02 — SEO"
        icon={Tags}
        sub="Titles, description, tags and chapters generated from the transcript."
        actions={
          <Button onClick={generate} disabled={loading}>
            {loading ? "Generating…" : metadata ? "Regenerate" : "Generate metadata"}
          </Button>
        }
      >
        Metadata
      </PageTitle>

      {fingerprint ? (
        <Badge tone="accent">
          <Sparkles className="h-3 w-3" />
          Conditioned on {fingerprint.channel.title}'s performance data
        </Badge>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-signal/25 bg-signal/5 p-4">
          <p className="text-sm text-ink-300">
            No channel connected — output will follow generic SEO best practice.
          </p>
          <Link to="/app/channel" className="text-sm text-signal underline underline-offset-2">
            Build a fingerprint
          </Link>
        </Card>
      )}

      {loading ? <RunningNote label="Gemini is drafting titles, description, tags and chapters…" /> : null}
      <ErrorNote error={error} onRetry={generate} />

      {metadata ? (
        <div className="space-y-8 fade-up">
          <section>
            <SectionTitle hint={`generated in ${(metadata.elapsedMs / 1000).toFixed(1)}s`}>
              Title options
            </SectionTitle>
            <div className="space-y-2">
              {metadata.titles.map((title, index) => (
                <Card key={index} className="p-4 transition hover:border-ink-600">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-ink-200">{title.text}</p>
                    <CopyButton value={title.text} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge>{title.angle}</Badge>
                    <span className={`text-xs ${title.charCount > 70 ? "text-signal" : "text-ink-500"}`}>
                      {title.charCount} chars
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink-400">{title.rationale}</p>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle hint={<CopyButton value={fullDescription} label="Copy with chapters" />}>
              Description
            </SectionTitle>
            <Card className="p-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-300">{metadata.description}</p>
            </Card>
          </section>

          {metadata.chapters?.length ? (
            <section>
              <SectionTitle hint={<CopyButton value={chaptersText} />}>Chapters</SectionTitle>
              <Card className="divide-y divide-ink-800">
                {metadata.chapters.map((chapter, index) => (
                  <div key={index} className="flex items-center gap-4 px-5 py-2.5">
                    <span className="font-mono text-xs text-accent">{chapter.timestamp}</span>
                    <span className="text-sm text-ink-300">{chapter.label}</span>
                  </div>
                ))}
              </Card>
            </section>
          ) : null}

          <section>
            <SectionTitle hint={<CopyButton value={metadata.tags.join(", ")} label="Copy all" />}>
              Tags
            </SectionTitle>
            <div className="flex flex-wrap gap-2">
              {metadata.tags.map((tag) => (
                <span key={tag} className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-sm text-ink-300">
                  {tag}
                </span>
              ))}
            </div>
          </section>

          {metadata.pinnedComment ? (
            <section>
              <SectionTitle hint={<CopyButton value={metadata.pinnedComment} />}>Pinned comment</SectionTitle>
              <Card className="p-5">
                <p className="text-sm text-ink-300">{metadata.pinnedComment}</p>
              </Card>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
