import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CHART_PALETTES } from "../lib/palette";
import { removeStorage, STORAGE_KEYS, writeStorage } from "../lib/storage";
import { applyTheme, darkQuery, normalizePreference, resolveTheme, storedPreference, systemPrefersDark } from "../lib/theme";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(storedPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolvedTheme = resolveTheme(preference, systemDark);

  useEffect(() => {
    const query = darkQuery();
    if (!query) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    if (query.addEventListener) query.addEventListener("change", onChange);
    else query.addListener?.(onChange);
    return () => {
      if (query.removeEventListener) query.removeEventListener("change", onChange);
      else query.removeListener?.(onChange);
    };
  }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEYS.theme) setPreferenceState(normalizePreference(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useLayoutEffect(() => {
    applyTheme(resolvedTheme, preference);
  }, [preference, resolvedTheme]);

  const setPreference = useCallback((next) => {
    const normalized = normalizePreference(next);
    setPreferenceState(normalized);
    writeStorage(STORAGE_KEYS.theme, normalized);
  }, []);

  const toggleTheme = useCallback(() => {
    setPreference(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setPreference]);

  const resetTheme = useCallback(() => {
    removeStorage(STORAGE_KEYS.theme);
    setPreferenceState("system");
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference, toggleTheme, resetTheme }),
    [preference, resolvedTheme, setPreference, toggleTheme, resetTheme]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

export function useChartPalette() {
  return CHART_PALETTES[useTheme().resolvedTheme] || CHART_PALETTES.light;
}
