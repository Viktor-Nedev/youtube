import { useState } from "react";
import { MessageSquare, AlertOctagon, HelpCircle, Heart, ThumbsDown, Ban } from "lucide-react";
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
  RunningNote
} from "../components/ui.jsx";

// Status-style colours ship with an icon + label, never colour alone.
const CATEGORY_META = {
  genuine_question: { label: "Question", tone: "accent", icon: HelpCircle },
  criticism: { label: "Criticism", tone: "signal", icon: ThumbsDown },
  toxic: { label: "Toxic", tone: "danger", icon: AlertOctagon },
  spam: { label: "Spam", tone: "danger", icon: Ban },
  positive_feedback: { label: "Positive", tone: "good", icon: Heart },
  other: { label: "Other", tone: "neutral", icon: MessageSquare }
};

const FILTERS = ["all", "genuine_question", "criticism", "toxic", "spam", "positive_feedback", "other"];

export default function CommentsPage() {
  const { fingerprint } = useApp();
  const [video, setVideo] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");

  const moderate = async () => {
    if (!video.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.moderateComments(video.trim(), 50));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const visible = result?.comments?.filter((c) => filter === "all" || c.category === filter) ?? [];

  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow="Step 06 — Community"
        icon={MessageSquare}
        sub="Sorts a comment section into spam, toxicity, real questions and praise — and drafts replies for the ones that deserve your time."
      >
        Comments
      </PageTitle>

      <Card className="p-5">
        <label className="mb-2 block text-sm text-ink-300">YouTube video URL or ID</label>
        <div className="flex flex-wrap gap-2">
          <input
            value={video}
            onChange={(e) => setVideo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && moderate()}
            placeholder="https://www.youtube.com/watch?v=…"
            className="min-w-64 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-ink-200 placeholder:text-ink-500 focus:border-accent focus:outline-none"
          />
          <Button onClick={moderate} disabled={loading || !video.trim()}>
            {loading ? "Triaging…" : "Triage comments"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Works on any public video — 1 YouTube API unit, plus one batched Gemini call.
        </p>
      </Card>

      {loading ? <RunningNote label="Fetching comments and classifying them in one batch…" /> : null}
      <ErrorNote error={error} onRetry={moderate} />

      {result ? (
        <div className="space-y-6 fade-up">
          <Card className="p-5">
            <p className="text-sm text-ink-300">{result.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-800 pt-4">
              <Badge tone="accent">{result.needsAttention} need you personally</Badge>
              {Object.entries(result.counts ?? {})
                .filter(([, count]) => count > 0)
                .map(([category, count]) => {
                  const meta = CATEGORY_META[category] ?? CATEGORY_META.other;
                  const Icon = meta.icon;
                  return (
                    <Badge key={category} tone={meta.tone}>
                      <Icon className="h-3 w-3" />
                      {meta.label} {count}
                    </Badge>
                  );
                })}
            </div>
          </Card>

          <div className="flex flex-wrap gap-1.5">
            {FILTERS.filter((f) => f === "all" || result.counts?.[f] > 0).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  filter === f ? "bg-ink-700 text-ink-200" : "text-ink-400 hover:bg-ink-850 hover:text-ink-300"
                }`}
              >
                {f === "all" ? `All ${result.total}` : `${CATEGORY_META[f]?.label ?? f} ${result.counts[f]}`}
              </button>
            ))}
          </div>

          <SectionTitle hint={`triaged in ${(result.elapsedMs / 1000).toFixed(1)}s`}>
            {visible.length} comments
          </SectionTitle>

          <div className="space-y-3">
            {visible.map((comment) => {
              const meta = CATEGORY_META[comment.category] ?? CATEGORY_META.other;
              const Icon = meta.icon;
              return (
                <Card key={comment.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {comment.authorImage ? (
                      <img src={comment.authorImage} alt="" className="h-8 w-8 shrink-0 rounded-full" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink-200">{comment.author}</span>
                        <Badge tone={meta.tone}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                        {comment.priority === "high" ? <Badge tone="accent">high priority</Badge> : null}
                        <span className="text-xs text-ink-500">{comment.likes} likes</span>
                      </div>
                      <p className="mt-1.5 text-sm text-ink-300">{comment.text}</p>

                      {comment.suggestedReply ? (
                        <div className="mt-3 rounded-lg border border-ink-800 bg-ink-900 p-3">
                          <div className="mb-1 flex items-center justify-between">
                            <p className="text-xs text-ink-500">Suggested reply</p>
                            <CopyButton value={comment.suggestedReply} />
                          </div>
                          <p className="text-sm text-ink-300">{comment.suggestedReply}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
