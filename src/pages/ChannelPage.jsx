import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  LabelList
} from "recharts";
import { Fingerprint, Sparkles, TrendingDown, Users, Video } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../lib/api.js";
import {
  Button,
  Card,
  PageTitle,
  SectionTitle,
  Badge,
  ErrorNote,
  RunningNote,
  formatNumber
} from "../components/ui.jsx";
import { VIZ, axisProps, gridProps, VizTooltip } from "../components/charts.jsx";

const FEATURE_LABELS = {
  question: "Question",
  number_listicle: "Number / listicle",
  how_to: "How-to",
  personal_story: "Personal story",
  superlative: "Superlative",
  curiosity_gap: "Curiosity gap",
  negative_framing: "Negative framing",
  urgency: "Urgency",
  named_entity: "Named entity",
  allcaps_emphasis: "ALL-CAPS emphasis"
};

export default function ChannelPage() {
  const { fingerprint, setFingerprint } = useApp();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyze = async (refresh = false) => {
    const channel = input.trim() || fingerprint?.channel?.customUrl || fingerprint?.channel?.id;
    if (!channel) return;

    setLoading(true);
    setError(null);
    try {
      const result = await api.analyzeChannel(channel, { refresh });
      setFingerprint(result.fingerprint);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const liftData = (fingerprint?.titlePatterns ?? []).map((pattern) => ({
    name: FEATURE_LABELS[pattern.feature] ?? pattern.feature,
    lift: pattern.lift,
    sampleSize: pattern.sampleSize,
    withMedian: pattern.withMedian,
    withoutMedian: pattern.withoutMedian
  }));

  return (
    <div className="space-y-10">
      <PageTitle
        eyebrow="The spine"
        icon={Fingerprint}
        sub="Analyses a channel's real published performance to work out what actually drives views there — then feeds that profile into every other module."
      >
        Channel Fingerprint
      </PageTitle>

      <Card className="p-5">
        <label className="mb-2 block text-sm text-ink-300">Channel handle, URL or ID</label>
        <div className="flex flex-wrap gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && analyze()}
            placeholder="@mkbhd"
            className="min-w-64 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-ink-200 placeholder:text-ink-500 focus:border-accent focus:outline-none"
          />
          <Button onClick={() => analyze(false)} disabled={loading || !input.trim()}>
            {loading ? "Analysing…" : "Analyse channel"}
          </Button>
          {fingerprint ? (
            <Button variant="ghost" onClick={() => analyze(true)} disabled={loading}>
              Refresh
            </Button>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Public data only — no login required. Costs about 5 of the 10,000 daily YouTube API units.
        </p>
      </Card>

      {loading ? <RunningNote label="Fetching uploads, labelling titles, computing lift…" /> : null}
      <ErrorNote error={error} />

      {fingerprint ? (
        <div className="space-y-10 fade-up">
          <Card className="flex flex-wrap items-center gap-5 p-5">
            {fingerprint.channel.thumbnail ? (
              <img
                src={fingerprint.channel.thumbnail}
                alt=""
                className="h-14 w-14 rounded-full border border-ink-700"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-ink-200">{fingerprint.channel.title}</h2>
              <div className="mt-1 flex flex-wrap gap-4 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {formatNumber(fingerprint.channel.subscribers)} subscribers
                </span>
                <span className="inline-flex items-center gap-1">
                  <Video className="h-3.5 w-3.5" />
                  {fingerprint.stats.analysedCount} videos analysed
                </span>
                <span>{formatNumber(fingerprint.stats.medianViews)} median views</span>
                <span>{fingerprint.stats.quotaUnitsUsed} quota units used</span>
              </div>
            </div>
            <Badge tone="accent">
              <Sparkles className="h-3 w-3" />
              Conditioning all modules
            </Badge>
          </Card>

          <section>
            <SectionTitle hint="lift = median views with the feature ÷ without it">
              What works in this channel's titles
            </SectionTitle>

            {liftData.length ? (
              <Card className="p-5">
                <ResponsiveContainer width="100%" height={Math.max(220, liftData.length * 42)}>
                  <BarChart data={liftData} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
                    <CartesianGrid {...gridProps} horizontal={false} vertical />
                    <XAxis type="number" {...axisProps} domain={[0, "dataMax + 0.3"]} />
                    <YAxis type="category" dataKey="name" width={130} {...axisProps} />
                    {/* 1.0x is the channel's own median — the only meaningful split point. */}
                    <ReferenceLine x={1} stroke={VIZ.muted} strokeDasharray="3 3" />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                      content={
                        <VizTooltip
                          formatter={(entry) =>
                            `${entry.payload.lift}× median · ${entry.payload.sampleSize} videos · ${formatNumber(
                              entry.payload.withMedian
                            )} vs ${formatNumber(entry.payload.withoutMedian)} views`
                          }
                        />
                      }
                    />
                    <Bar dataKey="lift" radius={[0, 4, 4, 0]} barSize={18}>
                      {liftData.map((entry) => (
                        <Cell key={entry.name} fill={entry.lift >= 1 ? VIZ.above : VIZ.below} />
                      ))}
                      {/* Direct labels so the value never depends on colour alone. */}
                      <LabelList
                        dataKey="lift"
                        position="right"
                        formatter={(value) => `${value}×`}
                        style={{ fill: VIZ.text, fontSize: 11 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-3 border-t border-ink-800 pt-3 text-xs text-ink-500">
                  Every figure is computed from the fetched statistics — the model labels title
                  structure, it never calculates the numbers.
                </p>
              </Card>
            ) : (
              <Card className="p-5 text-sm text-ink-400">
                Not enough videos share a title pattern to measure lift reliably. A channel needs
                roughly 15+ videos for this.
              </Card>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-medium text-ink-200">Positioning</h3>
              <p className="text-sm leading-relaxed text-ink-400">{fingerprint.insights.positioning}</p>
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-medium text-ink-200">Winning formula</h3>
              <p className="text-sm leading-relaxed text-ink-400">{fingerprint.insights.winningFormula}</p>
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-medium text-ink-200">Title voice</h3>
              <p className="text-sm leading-relaxed text-ink-400">{fingerprint.insights.voice}</p>
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-medium text-ink-200">Thumbnail style</h3>
              <p className="text-sm leading-relaxed text-ink-400">{fingerprint.insights.thumbnailStyle}</p>
            </Card>
          </section>

          {fingerprint.durationPerformance?.length ? (
            <section>
              <SectionTitle>Length vs performance</SectionTitle>
              <Card className="p-5">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={fingerprint.durationPerformance} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="bucket" {...axisProps} />
                    <YAxis {...axisProps} tickFormatter={formatNumber} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                      content={
                        <VizTooltip
                          formatter={(entry) =>
                            `${formatNumber(entry.payload.medianViews)} median views · ${entry.payload.count} videos`
                          }
                        />
                      }
                    />
                    <Bar dataKey="medianViews" fill={VIZ.series} radius={[4, 4, 0, 0]} barSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </section>
          ) : null}

          {fingerprint.underperformers?.length ? (
            <section>
              <SectionTitle hint="diagnosed against the patterns above">
                <span className="inline-flex items-center gap-2">
                  <TrendingDown className="h-3.5 w-3.5" />
                  Underperformers
                </span>
              </SectionTitle>
              <div className="space-y-3">
                {fingerprint.underperformers.map((video) => (
                  <Card key={video.id} className="p-5">
                    <div className="flex flex-wrap items-start gap-4">
                      {video.thumbnail ? (
                        <img src={video.thumbnail} alt="" className="h-16 w-28 rounded-md object-cover" />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-medium text-ink-200">{video.title}</h4>
                          <Badge tone="danger">{video.performanceRatio}× median</Badge>
                          <span className="text-xs text-ink-500">{formatNumber(video.views)} views</span>
                        </div>
                        <ul className="mt-3 space-y-1.5">
                          {video.hypotheses.map((hypothesis, index) => (
                            <li key={index} className="flex gap-2 text-sm text-ink-400">
                              <span className="text-ink-600">→</span>
                              {hypothesis}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                          <p className="mb-0.5 text-xs text-ink-500">Suggested rewrite</p>
                          <p className="text-sm text-ink-300">{video.rewrittenTitle}</p>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
