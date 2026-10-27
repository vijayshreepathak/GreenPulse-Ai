import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { readJson, readStorage, removeStorage, STORAGE_KEYS, writeStorage } from "../lib/storage";

export const DEFAULT_PREFERENCES = {
  motion: "system", // "system" | "reduce" | "full"
  backgroundRefresh: true,
  mapScrollZoom: true,
  aiAssistant: true,
};

const MOTION_VALUES = ["system", "reduce", "full"];
const PreferencesContext = createContext(null);

export function sanitizePreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    motion: MOTION_VALUES.includes(source.motion) ? source.motion : DEFAULT_PREFERENCES.motion,
    backgroundRefresh: typeof source.backgroundRefresh === "boolean" ? source.backgroundRefresh : DEFAULT_PREFERENCES.backgroundRefresh,
    mapScrollZoom: typeof source.mapScrollZoom === "boolean" ? source.mapScrollZoom : DEFAULT_PREFERENCES.mapScrollZoom,
    aiAssistant: typeof source.aiAssistant === "boolean" ? source.aiAssistant : DEFAULT_PREFERENCES.aiAssistant,
  };
}

function systemReducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  } catch {
    return null;
  }
}

export function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(() => sanitizePreferences(readJson(STORAGE_KEYS.preferences, {})));
  const [systemReduce, setSystemReduce] = useState(() => Boolean(systemReducedMotion()?.matches));
  const [tourCompleted, setTourCompleted] = useState(() => readStorage(STORAGE_KEYS.tour) === "true");

  useEffect(() => {
    const query = systemReducedMotion();
    if (!query?.addEventListener) return undefined;
    const onChange = (event) => setSystemReduce(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const reducedMotion = preferences.motion === "reduce" || (preferences.motion === "system" && systemReduce);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduce" : "full";
  }, [reducedMotion]);

  const updatePreference = useCallback((key, value) => {
    setPreferences((current) => {
      const next = sanitizePreferences({ ...current, [key]: value });
      writeStorage(STORAGE_KEYS.preferences, JSON.stringify(next));
      return next;
    });
  }, []);

  const markTourCompleted = useCallback((completed = true) => {
    setTourCompleted(completed);
    if (completed) writeStorage(STORAGE_KEYS.tour, "true");
    else removeStorage(STORAGE_KEYS.tour);
  }, []);

  const resetPreferences = useCallback(() => {
    removeStorage(STORAGE_KEYS.preferences);
    removeStorage(STORAGE_KEYS.tour);
    setPreferences(DEFAULT_PREFERENCES);
    setTourCompleted(false);
  }, []);

  const value = useMemo(
    () => ({ preferences, reducedMotion, updatePreference, resetPreferences, tourCompleted, markTourCompleted }),
    [preferences, reducedMotion, updatePreference, resetPreferences, tourCompleted, markTourCompleted]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences must be used inside PreferencesProvider");
  return context;
}
