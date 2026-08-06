import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { api } from "../lib/api.js";

/**
 * Shared state across every module.
 *
 * Two things are global by design:
 *  - the active project (upload it once, every module reuses its transcript)
 *  - the active channel fingerprint (conditions generation everywhere)
 *
 * That sharing is what makes this one product rather than five separate tools.
 */

const AppContext = createContext(null);

const ACTIVE_PROJECT_KEY = "copilot.activeProjectId";

export function AppProvider({ children }) {
  // Plain setter, so callers can still use the functional-updater form.
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState([]);
  const [fingerprint, setFingerprint] = useState(null);
  const [health, setHealth] = useState(null);

  // Guards the persistence effect below until the initial restore has run,
  // otherwise the opening `project === null` would erase the saved id first.
  const restored = useRef(false);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ ok: false }));
    api.activeChannel()
      .then((res) => res.fingerprint && setFingerprint(res.fingerprint))
      .catch(() => {});

    api.listProjects()
      .then(async (res) => {
        const list = res.projects ?? [];
        setProjects(list);

        let savedId = null;
        try {
          savedId = localStorage.getItem(ACTIVE_PROJECT_KEY);
        } catch {
          /* storage unavailable (private mode) */
        }

        // Prefer the remembered project; otherwise fall back to the most recent
        // upload, so opening the app in a fresh browser doesn't show every
        // module as empty while finished work sits on the server.
        const target = savedId && list.some((p) => p.id === savedId) ? savedId : list[0]?.id;

        // The list payload is a summary, so re-fetch the full project.
        if (target) {
          const full = await api.getProject(target).catch(() => null);
          if (full?.project) setProject(full.project);
        }
      })
      .catch(() => {})
      .finally(() => {
        restored.current = true;
      });
  }, []);

  /**
   * Remembers which project is active across reloads. Without this a refresh
   * drops every module back to its empty state even though the upload and its
   * transcript are still on the server.
   */
  useEffect(() => {
    if (!restored.current) return;
    try {
      if (project?.id) localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
      else localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {
      /* storage unavailable — in-memory state still works */
    }
  }, [project?.id]);

  const refreshProjects = useCallback(async () => {
    const res = await api.listProjects();
    setProjects(res.projects ?? []);
    return res.projects;
  }, []);

  /** Merges a module's result into the active project so pages stay in sync. */
  const patchProject = useCallback((patch) => {
    setProject((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo(
    () => ({
      project,
      setProject,
      patchProject,
      projects,
      refreshProjects,
      fingerprint,
      setFingerprint,
      health,
      hasTranscript: Boolean(project?.transcript?.segments?.length)
    }),
    [project, projects, fingerprint, health, patchProject, refreshProjects]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
