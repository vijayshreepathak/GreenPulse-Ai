import { readStorage, STORAGE_KEYS } from "./storage";

export const THEME_PREFERENCES = ["light", "dark", "system"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function normalizePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
}

export function darkQuery() {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

export function systemPrefersDark() {
  return Boolean(darkQuery()?.matches);
}

export function resolveTheme(preference, systemDark) {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export function storedPreference() {
  return normalizePreference(readStorage(STORAGE_KEYS.theme));
}

export function applyTheme(resolved, preference) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#0d1512" : "#f5f4ef");
}
