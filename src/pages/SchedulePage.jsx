import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Upload, ExternalLink, Trash2, ShieldCheck } from "lucide-react";
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
  formatDuration
} from "../components/ui.jsx";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Days for a month grid, padded so the 1st lands on the right weekday. */
function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  // JS weeks start Sunday; the grid starts Monday.
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const sameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function SchedulePage() {
  const { project } = useApp();
  const [params] = useSearchParams();

  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(params.get("error"));
  const [publishing, setPublishing] = useState(false);

  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(null);
  const [time, setTime] = useState("18:00");
  const [source, setSource] = useState("source");
  const [clipIndex, setClipIndex] = useState(1);
  const [title, setTitle] = useState("");

  const refresh = () => {
    api.authStatus().then(setStatus).catch(() => setStatus({ configured: false }));
    api.schedule().then((r) => setItems(r.items ?? [])).catch(() => {});
  };

  useEffect(refresh, []);

  // Seed the title from generated metadata when there is some.
  useEffect(() => {
    if (project?.metadata?.titles?.[0]?.text && !title) setTitle(project.metadata.titles[0].text);
  }, [project?.metadata]);

  const cells = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const clips = project?.clips?.clips ?? [];

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      // A date plus a time-of-day becomes the publishAt instant.
      let publishAt = null;
      if (selected) {
        const [h, m] = time.split(":").map(Number);
        const when = new Date(selected);
        when.setHours(h, m, 0, 0);
        publishAt = when.toISOString();
      }

      await api.publish({
        projectId: project.id,
        source,
        clipIndex: source === "clip" ? clipIndex : undefined,
        title,
        description: project?.metadata?.description ?? "",
        tags: project?.metadata?.tags ?? [],
        publishAt
      });

      setSelected(null);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow="Step 07 — Distribution"
        icon={CalendarDays}
        sub="Upload finished videos and Shorts straight to your channel, or pick a slot and let YouTube publish them for you."
      >
        Schedule
      </PageTitle>

      <ErrorNote error={error} />

      {!status?.configured ? (
        <Card className="border-signal/30 bg-signal/5 p-5">
          <h3 className="mb-2 flex items-center gap-2 font-medium text-signal">
            <ShieldCheck className="h-4 w-4" />
            Google OAuth isn't configured yet
          </h3>
          <p className="mb-3 text-sm text-ink-300">{status?.hint}</p>
          <p className="text-xs text-ink-500">
            Uploading writes to your channel, so unlike the read-only modules it needs your consent
            rather than an API key. The <code className="rounded bg-ink-900 px-1">youtube.upload</code>{" "}
            scope is sensitive, so until the app is verified by Google it works only for accounts you
            add as test users on the consent screen — which is all a creator needs for their own channel.
          </p>
        </Card>
      ) : !status?.connected ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h3 className="font-medium text-ink-200">Connect your YouTube channel</h3>
            <p className="mt-1 text-sm text-ink-400">
              Grants upload access only. You can disconnect at any time.
            </p>
          </div>
          <a href="/api/auth/google">
            <Button>Connect YouTube</Button>
          </a>
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center gap-4 p-5">
          {status.channel?.thumbnail ? (
            <img src={status.channel.thumbnail} alt="" className="h-10 w-10 rounded-full" />
          ) : null}
          <div className="flex-1">
            <p className="font-medium text-ink-200">{status.channel?.title ?? "Connected"}</p>
            <p className="text-xs text-ink-500">Ready to upload</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => api.disconnect().then(refresh)}
          >
            Disconnect
          </Button>
        </Card>
      )}

      {status?.connected && project ? (
        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-medium text-ink-100">{monthLabel}</h3>
              <div className="flex gap-1">
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                >
                  ‹
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                >
                  ›
                </Button>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((day) => (
                <div key={day} className="eyebrow py-1 text-center text-ink-500">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((date, index) => {
                if (!date) return <div key={index} />;
                const past = date < new Date(new Date().toDateString());
                const scheduled = items.filter((i) => i.publishAt && sameDay(new Date(i.publishAt), date));
                const isSelected = sameDay(selected, date);

                return (
                  <button
                    key={index}
                    disabled={past}
                    onClick={() => setSelected(date)}
                    className={`aspect-square rounded-lg border p-1.5 text-left text-sm transition ${
                      isSelected
                        ? "border-accent bg-accent/15 text-ink-100"
                        : past
                          ? "border-transparent text-ink-600"
                          : "border-ink-800 text-ink-300 hover:border-ink-600 hover:bg-ink-850"
                    }`}
                  >
                    <span className="tabular">{date.getDate()}</span>
                    {scheduled.length ? (
                      <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-accent" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <SectionTitle>{selected ? `Schedule for ${selected.toDateString()}` : "Publish now"}</SectionTitle>

            <div>
              <label className="mb-1.5 block text-xs text-ink-400">What to upload</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-accent focus:outline-none"
              >
                <option value="source">Full video ({project.originalName})</option>
                {clips.map((clip) => (
                  <option key={clip.index} value="clip">
                    Short {clip.index} — {clip.title}
                  </option>
                ))}
              </select>
            </div>

            {source === "clip" && clips.length ? (
              <div>
                <label className="mb-1.5 block text-xs text-ink-400">Which Short</label>
                <select
                  value={clipIndex}
                  onChange={(e) => setClipIndex(Number(e.target.value))}
                  className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-accent focus:outline-none"
                >
                  {clips.map((clip) => (
                    <option key={clip.index} value={clip.index}>
                      {clip.index}. {clip.title} ({formatDuration(clip.durationSec)})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className="mb-1.5 block text-xs text-ink-400">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-accent focus:outline-none"
              />
            </div>

            {selected ? (
              <div>
                <label className="mb-1.5 block text-xs text-ink-400">Publish time</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-accent focus:outline-none"
                />
              </div>
            ) : null}

            <Button onClick={publish} disabled={publishing || !title.trim()} className="w-full">
              <Upload className="h-4 w-4" />
              {publishing ? "Uploading…" : selected ? "Schedule" : "Upload as private"}
            </Button>

            <p className="text-xs text-ink-500">
              {selected
                ? "Uploads as private with a publish time — YouTube makes it public itself at that moment."
                : "Uploads as private so you can review it in Studio before going public."}
            </p>
            {selected ? (
              <button onClick={() => setSelected(null)} className="text-xs text-ink-400 hover:text-ink-200">
                Clear date and upload now instead
              </button>
            ) : null}
          </Card>
        </section>
      ) : null}

      {publishing ? <RunningNote label="Uploading to YouTube — large files take a while…" /> : null}

      {items.length ? (
        <section>
          <SectionTitle hint={`${items.length} uploaded from this app`}>Queue</SectionTitle>
          <div className="space-y-2">
            {items.map((item) => (
              <Card key={item.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-200">{item.title}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {item.publishAt
                      ? `Publishes ${new Date(item.publishAt).toLocaleString()}`
                      : `Uploaded ${new Date(item.uploadedAt).toLocaleString()}`}
                  </p>
                </div>
                <Badge tone={item.publishAt ? "accent" : "neutral"}>
                  {item.publishAt ? "scheduled" : item.privacyStatus}
                </Badge>
                <a href={item.studioUrl} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Studio
                  </Button>
                </a>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => api.unschedule(item.id).then((r) => setItems(r.items))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
