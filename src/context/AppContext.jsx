import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
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

export function AppProvider({ children }) {
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState([]);
  const [fingerprint, setFingerprint] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ ok: false }));
    api.activeChannel()
      .then((res) => res.fingerprint && setFingerprint(res.fingerprint))
      .catch(() => {});
    api.listProjects()
      .then((res) => setProjects(res.projects ?? []))
      .catch(() => {});
  }, []);

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
