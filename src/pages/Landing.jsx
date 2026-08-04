import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import {
  ArrowRight,
  Fingerprint,
  Tags,
  Image as ImageIcon,
  Scissors,
  MessageSquare,
  BarChart3
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

/**
 * Scroll-driven cinematic hero.
 *
 * Three cinematic plates are layered and cross-dissolved as you scroll, each
 * pushing in slightly — scroll position drives the cut and the camera move, so
 * it reads as continuous motion rather than a slideshow.
 *
 * Full-resolution <img> layers rather than a canvas frame sequence: with only
 * three plates the decoder never thrashes, and the images stay sharp at any
 * viewport size instead of being locked to a pre-rendered frame width.
 */

// Served from public/ so the plates ship with the repo and survive a fresh
// clone — data/ is gitignored and holds only per-run generated output.
const SCENES = [
  { src: "/hero/shot-wide.jpg", alt: "" },
  { src: "/hero/shot-close.jpg", alt: "" },
  { src: "/hero/shot-output.jpg", alt: "" }
];

const BEATS = [
  {
    title: ["Your channel already", "told you what works."],
    body: "Most tools guess. This one reads your published performance first."
  },
  {
    title: ["Upload once.", "Six modules, one context."],
    body: "Transcript, metadata, thumbnail, Shorts, analytics and comment triage — all sharing the same video and the same channel profile."
  },
  {
    title: ["Real files.", "Not mockups."],
    body: "A finished thumbnail PNG. Vertical clips with burned-in captions. Everything downloadable.",
    cta: true
  }
];

const MODULES = [
  {
    icon: Fingerprint,
    title: "Channel Fingerprint",
    body: "Measures which title patterns, lengths and topics actually move views on your channel — then conditions everything else on it."
  },
  {
    icon: Tags,
    title: "Metadata",
    body: "Titles, description, tags and chapters from the transcript, written in your channel's proven voice."
  },
  {
    icon: ImageIcon,
    title: "Thumbnails",
    body: "Every frame scored locally, the best judged by Gemini vision, the winner rendered as a finished PNG."
  },
  {
    icon: Scissors,
    title: "Shorts",
    body: "Finds self-contained moments and cuts real 9:16 clips with burned-in captions."
  },
  {
    icon: BarChart3,
    title: "Analytics",
    body: "Every upload against your own median, with the underperformers diagnosed."
  },
  {
    icon: MessageSquare,
    title: "Comments",
    body: "Spam, toxicity and real questions separated — with replies drafted for the ones that matter."
  }
];

export default function Landing() {
  const pinRef = useRef(null);
  const sceneRefs = useRef([]);
  const beatRefs = useRef([]);
  const [ready, setReady] = useState(false);

  // Smooth scrolling makes the crossfade feel like a camera move, not a jump.
  useEffect(() => {
    const lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    let frame = 0;
    const raf = (time) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    lenis.on("scroll", ScrollTrigger.update);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  // Preload the plates so the first dissolve never flashes an empty layer.
  useEffect(() => {
    let cancelled = false;
    let remaining = SCENES.length;

    const done = () => {
      remaining -= 1;
      if (remaining <= 0 && !cancelled) setReady(true);
    };

    for (const scene of SCENES) {
      const img = new Image();
      img.onload = done;
      img.onerror = done; // a missing plate must not block the page
      img.src = scene.src;
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const ctx = gsap.context(() => {
      const scenes = sceneRefs.current.filter(Boolean);
      const beats = beatRefs.current.filter(Boolean);

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: pinRef.current,
          start: "top top",
          end: "+=320%",
          pin: true,
          scrub: 0.8
        }
      });

      // Continuous push-in across the whole sequence.
      scenes.forEach((scene, index) => {
        gsap.set(scene, { opacity: index === 0 ? 1 : 0, scale: 1 });
        timeline.to(scene, { scale: 1.16, ease: "none", duration: 1 }, 0);
      });

      // Cross-dissolve: each plate hands over to the next.
      timeline.to(scenes[0], { opacity: 0, ease: "none", duration: 0.1 }, 0.3);
      timeline.to(scenes[1], { opacity: 1, ease: "none", duration: 0.1 }, 0.3);
      timeline.to(scenes[1], { opacity: 0, ease: "none", duration: 0.1 }, 0.63);
      timeline.to(scenes[2], { opacity: 1, ease: "none", duration: 0.1 }, 0.63);

      // Beats are staged so exactly one is legible at a time.
      const windows = [
        { in: null, out: 0.24 },
        { in: 0.36, out: 0.57 },
        { in: 0.7, out: null }
      ];

      beats.forEach((beat, index) => {
        const win = windows[index];
        if (win.in !== null) {
          gsap.set(beat, { opacity: 0, y: 26 });
          timeline.to(beat, { opacity: 1, y: 0, ease: "none", duration: 0.08 }, win.in);
        }
        if (win.out !== null) {
          timeline.to(beat, { opacity: 0, y: -26, ease: "none", duration: 0.08 }, win.out);
        }
      });
    }, pinRef);

    return () => ctx.revert();
  }, [ready]);

  return (
    <div className="bg-ink-950">
      <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-8 py-5">
        <span className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-display text-sm font-bold text-white">
            C
          </span>
          <span className="font-display font-semibold tracking-tight text-ink-100">Creator Copilot</span>
        </span>
        <Link
          to="/app"
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-ink-100 backdrop-blur-md transition hover:bg-white/10"
        >
          Open app
        </Link>
      </header>

      <section ref={pinRef} className="grain relative h-screen overflow-hidden bg-ink-990">
        {SCENES.map((scene, index) => (
          <div
            key={scene.src}
            ref={(el) => (sceneRefs.current[index] = el)}
            className="absolute inset-0 will-change-transform"
            style={{ opacity: index === 0 ? 1 : 0 }}
          >
            <img src={scene.src} alt={scene.alt} className="h-full w-full object-cover" />
          </div>
        ))}

        {/* Scrims are directional and light-handed. The previous three-stop
            gradient washed the plates to near-black, which is why nothing showed.
            The left wash exists purely so the title stays legible over whichever
            plate is on screen. */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/90 via-ink-950/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink-950 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink-950/70 to-transparent" />

        {/* Anchored low-left like a film title card: keeps the plate's focal area
            visible above, and fills what was an empty black void below. */}
        <div className="relative flex h-full items-end px-8 pb-28">
          {/* All beats occupy the same grid cell so they cross-fade in place.
              Beat 1 is visible with no JavaScript, so the hero is never blank. */}
          <div className="mx-auto grid w-full max-w-6xl">
            {BEATS.map((beat, index) => (
              <div
                key={index}
                ref={(el) => (beatRefs.current[index] = el)}
                className="col-start-1 row-start-1 max-w-3xl"
                style={{ opacity: index === 0 ? 1 : 0 }}
              >
                <h1 className="text-display font-semibold text-white">
                  {beat.title.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </h1>
                <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-200">{beat.body}</p>
                {beat.cta ? (
                  <Link
                    to="/app"
                    className="mt-9 inline-flex items-center gap-2 rounded-xl bg-accent px-7 py-3.5 font-medium text-white shadow-[0_12px_32px_-10px_rgba(255,74,50,0.7)] transition hover:bg-accent-soft"
                  >
                    Start building
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-9 right-10 flex items-center gap-3">
          <span className="eyebrow text-ink-500">Scroll</span>
          <span className="h-px w-14 bg-gradient-to-r from-ink-500 to-transparent" />
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-8 py-32">
        <p className="eyebrow mb-5 text-accent">The system</p>
        <h2 className="max-w-3xl text-title font-semibold text-ink-100">
          Six modules that share one brain
        </h2>
        <p className="mt-5 max-w-2xl leading-relaxed text-ink-400">
          The Channel Fingerprint is computed once from real published data, then injected into every
          generation prompt. That's the difference between generic SEO output and output that fits
          your channel.
        </p>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-ink-800 bg-ink-800 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="group bg-ink-900 p-8 transition-colors hover:bg-ink-850">
              <Icon className="mb-5 h-5 w-5 text-accent" />
              <h3 className="mb-2.5 font-display text-lg font-medium text-ink-100">{title}</h3>
              <p className="text-sm leading-relaxed text-ink-400">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-ink-700/60 bg-ink-850 p-9">
          <div>
            <h3 className="font-display text-xl font-medium text-ink-100">
              Point it at any public channel
            </h3>
            <p className="mt-2 text-sm text-ink-400">
              No login, no OAuth. Public data only — roughly 5 of the 10,000 free daily API units.
            </p>
          </div>
          <Link
            to="/app"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-medium text-white transition hover:bg-accent-soft"
          >
            Open the app
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
