import { Routes, Route, NavLink, useLocation, Link } from "react-router-dom";
import {
  Fingerprint,
  Tags,
  Image as ImageIcon,
  BarChart3,
  MessageSquare,
  Scissors,
  Upload,
  CalendarDays
} from "lucide-react";
import { useApp } from "./context/AppContext.jsx";
import Landing from "./pages/Landing.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ChannelPage from "./pages/ChannelPage.jsx";
import MetadataPage from "./pages/MetadataPage.jsx";
import ThumbnailPage from "./pages/ThumbnailPage.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import CommentsPage from "./pages/CommentsPage.jsx";
import ClipsPage from "./pages/ClipsPage.jsx";
import SchedulePage from "./pages/SchedulePage.jsx";

const NAV = [
  { to: "/app", label: "Upload", icon: Upload, end: true },
  { to: "/app/channel", label: "Channel Fingerprint", icon: Fingerprint },
  { to: "/app/metadata", label: "Metadata", icon: Tags },
  { to: "/app/thumbnail", label: "Thumbnail", icon: ImageIcon },
  { to: "/app/clips", label: "Shorts", icon: Scissors },
  { to: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/app/comments", label: "Comments", icon: MessageSquare },
  { to: "/app/schedule", label: "Schedule", icon: CalendarDays }
];

function Shell({ children }) {
  const { project, fingerprint } = useApp();

  return (
    <div className="flex min-h-screen bg-ink-950">
      <aside className="sticky top-0 flex h-screen w-[15.5rem] shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-6">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-display text-sm font-bold text-white">
            C
          </span>
          <span className="font-display font-semibold tracking-tight text-ink-100">Creator Copilot</span>
        </Link>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-ink-800 font-medium text-ink-100"
                    : "text-ink-400 hover:bg-ink-850 hover:text-ink-200"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active marker gives the nav a spine instead of a flat fill */}
                  <span
                    className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent transition-opacity ${
                      isActive ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <Icon className={`h-4 w-4 ${isActive ? "text-accent" : ""}`} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Persistent context strip: what every module is currently working from. */}
        <div className="space-y-2 border-t border-ink-800 p-3">
          <div className="rounded-lg border border-ink-800 bg-ink-850 px-3 py-2.5">
            <p className="eyebrow mb-1 text-ink-500">Active video</p>
            <p className="truncate text-xs text-ink-300">{project?.originalName ?? "None uploaded"}</p>
          </div>
          <div className="rounded-lg border border-ink-800 bg-ink-850 px-3 py-2.5">
            <p className="eyebrow mb-1 text-ink-500">Fingerprint</p>
            <p className="truncate text-xs text-ink-300">
              {fingerprint ? fingerprint.channel.title : "No channel connected"}
            </p>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-10 py-12">{children}</div>
      </main>
    </div>
  );
}

export default function App() {
  const location = useLocation();

  // The landing page is a full-bleed cinematic experience, so it renders
  // outside the dashboard shell.
  if (location.pathname === "/") {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/app" element={<Dashboard />} />
        <Route path="/app/channel" element={<ChannelPage />} />
        <Route path="/app/metadata" element={<MetadataPage />} />
        <Route path="/app/thumbnail" element={<ThumbnailPage />} />
        <Route path="/app/clips" element={<ClipsPage />} />
        <Route path="/app/analytics" element={<AnalyticsPage />} />
        <Route path="/app/comments" element={<CommentsPage />} />
        <Route path="/app/schedule" element={<SchedulePage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </Shell>
  );
}
