import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

/**
 * Shared primitives. One file so the visual language can't drift between pages.
 *
 * Two rules the whole UI leans on:
 *  - Headings use the display face; metrics use the mono face with tabular figures.
 *  - Surfaces sit on a deliberate elevation ladder (page < card < raised), so
 *    data-dense panels advance and chrome recedes.
 */

export function Button({ children, variant = "primary", size = "md", className = "", ...props }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-px";

  const variants = {
    primary:
      "bg-accent text-white hover:bg-accent-soft shadow-[0_1px_0_0_rgba(255,255,255,0.14)_inset,0_8px_24px_-8px_rgba(255,74,50,0.6)]",
    ghost: "bg-ink-800 text-ink-200 hover:bg-ink-700 border border-ink-700 hover:border-ink-600",
    subtle: "text-ink-400 hover:text-ink-100 hover:bg-ink-800"
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2.5 text-sm",
    lg: "px-6 py-3 text-base"
  };

  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

/** `raised` lifts a panel off the page plane — use it for the primary result of a module. */
export function Card({ children, className = "", raised = false }) {
  const elevation = raised
    ? "border-ink-600/80 bg-ink-800 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_16px_40px_-24px_rgba(0,0,0,0.9)]"
    : "border-ink-700/60 bg-ink-850 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]";

  return <div className={`rounded-xl border ${elevation} ${className}`}>{children}</div>;
}

/** Page header — the display face at title scale, with an optional eyebrow. */
export function PageTitle({ eyebrow, icon: Icon, children, sub, actions }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-3 text-accent">{eyebrow}</p> : null}
        <h1 className="flex items-center gap-3 text-title font-semibold text-ink-100">
          {Icon ? <Icon className="h-7 w-7 shrink-0 text-accent" /> : null}
          {children}
        </h1>
        {sub ? <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-400">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, hint }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="eyebrow text-ink-400">{children}</h2>
      {hint ? <span className="text-xs text-ink-500">{hint}</span> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className = "" }) {
  const tones = {
    neutral: "bg-ink-800 text-ink-300 border-ink-700",
    accent: "bg-accent/12 text-accent-soft border-accent/30",
    good: "bg-good/12 text-good border-good/30",
    signal: "bg-signal/12 text-signal border-signal/30",
    danger: "bg-red-500/12 text-red-400 border-red-500/30"
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Large figure for stat tiles — mono, tabular, so columns of numbers line up. */
export function Stat({ label, value, suffix, tone = "default" }) {
  return (
    <Card className="p-5">
      <p className="eyebrow text-ink-500">{label}</p>
      <p
        className={`tabular mt-2 text-3xl font-semibold ${tone === "accent" ? "text-accent-soft" : "text-ink-100"}`}
      >
        {value}
        {suffix ? <span className="ml-1 text-lg text-ink-500">{suffix}</span> : null}
      </p>
    </Card>
  );
}

export function Spinner({ className = "" }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;
}

export function CopyButton({ value, label = "Copy", className = "" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (insecure context) — silently ignore */
    }
  };

  return (
    <button
      onClick={copy}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-500 transition hover:bg-ink-800 hover:text-ink-200 ${className}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-good" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/8 px-4 py-3 text-sm text-red-300">
      <p>{String(error)}</p>
      {onRetry ? (
        <button onClick={onRetry} className="mt-2 text-xs underline underline-offset-2 hover:text-red-200">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-700 px-6 py-20 text-center">
      {Icon ? <Icon className="mb-4 h-7 w-7 text-ink-600" /> : null}
      <h3 className="mb-2 text-lg font-medium text-ink-200">{title}</h3>
      <div className="max-w-sm text-sm leading-relaxed text-ink-400">{children}</div>
    </div>
  );
}

export function RunningNote({ label }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-4 py-3 text-sm text-ink-300">
      <Spinner className="text-accent" />
      {label}
    </div>
  );
}

export const formatNumber = (value) => {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
};

export const formatDuration = (sec) => {
  const total = Math.round(Number(sec) || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};
