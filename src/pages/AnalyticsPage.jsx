import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine
} from "recharts";
import { BarChart3, Fingerprint, Table2 } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import {
  Card,
  PageTitle,
  SectionTitle,
  Stat,
  Badge,
  EmptyState,
  formatNumber,
  formatDuration
} from "../components/ui.jsx";
import { VIZ, axisProps, gridProps, VizTooltip } from "../components/charts.jsx";

export default function AnalyticsPage() {
  const { fingerprint } = useApp();
  const [showTable, setShowTable] = useState(false);

  const videos = useMemo(
    () => (fingerprint?.videos ?? []).slice().sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt)),
    [fingerprint]
  );

  const chartData = useMemo(
    () =>
      videos.map((video, index) => ({
        label: `#${index + 1}`,
        title: video.title,
        views: video.views,
        performanceRatio: video.performanceRatio,
        publishedAt: video.publishedAt,
        isMature: video.isMature
      })),
    [videos]
  );

  if (!fingerprint) {
    return (
      <EmptyState icon={Fingerprint} title="No channel connected">
        Build a fingerprint on the{" "}
        <Link to="/app/channel" className="text-accent underline underline-offset-2">
          Channel
        </Link>{" "}
        page to see performance analytics here.
      </EmptyState>
    );
  }

  const median = fingerprint.stats.medianViews;
  const overperformers = videos.filter((v) => v.performanceRatio >= 1).length;

  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow="Step 05 — Measurement"
        icon={BarChart3}
        sub={`${fingerprint.channel.title} — ${videos.length} most recent uploads, each measured against the channel's own median.`}
      >
        Analytics
      </PageTitle>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Median views" value={formatNumber(median)} />
        <Stat label="Above median" value={overperformers} suffix={`/ ${videos.length}`} />
        <Stat label="Subscribers" value={formatNumber(fingerprint.channel.subscribers)} />
      </section>

      <section>
        <SectionTitle hint="oldest → newest, split at the channel median">
          Views per video
        </SectionTitle>
        <Card className="p-5">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
              <YAxis {...axisProps} tickFormatter={formatNumber} />
              <ReferenceLine y={median} stroke={VIZ.muted} strokeDasharray="3 3" />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                content={
                  <VizTooltip
                    labelFormatter={() => ""}
                    formatter={(entry) =>
                      `${entry.payload.title}\n${formatNumber(entry.payload.views)} views · ${
                        entry.payload.performanceRatio
                      }× median`
                    }
                  />
                }
              />
              <Bar dataKey="views" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.views >= median ? VIZ.above : VIZ.below} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-3">
            {/* Legend: two series-equivalents on screen, so identity is never colour-alone. */}
            <div className="flex gap-4 text-xs text-ink-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: VIZ.above }} />
                At or above median
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: VIZ.below }} />
                Below median
              </span>
            </div>
            <button
              onClick={() => setShowTable((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-200"
            >
              <Table2 className="h-3.5 w-3.5" />
              {showTable ? "Hide" : "Show"} table view
            </button>
          </div>
        </Card>
      </section>

      {showTable ? (
        <section className="fade-up">
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-800 text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 text-right font-medium">Views</th>
                  <th className="px-4 py-3 text-right font-medium">Likes</th>
                  <th className="px-4 py-3 text-right font-medium">Length</th>
                  <th className="px-4 py-3 text-right font-medium">vs median</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {videos
                  .slice()
                  .sort((a, b) => b.views - a.views)
                  .map((video) => (
                    <tr key={video.id} className="hover:bg-ink-900/50">
                      <td className="max-w-md truncate px-4 py-2.5 text-ink-300">{video.title}</td>
                      <td className="tabular px-4 py-2.5 text-right text-ink-300">
                        {formatNumber(video.views)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-ink-400">
                        {formatNumber(video.likes)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-ink-400">
                        {formatDuration(video.durationSec)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Badge tone={video.performanceRatio >= 1 ? "good" : "neutral"}>
                          {video.performanceRatio}×
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}

      {fingerprint.topicPerformance?.length ? (
        <section>
          <SectionTitle hint="median views per topic cluster">Topics</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fingerprint.topicPerformance.map((topic) => (
              <Card key={topic.topic} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize text-ink-200">{topic.topic}</span>
                  <Badge tone={topic.lift >= 1 ? "good" : "neutral"}>{topic.lift}×</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {formatNumber(topic.medianViews)} median views · {topic.count} videos
                </p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
