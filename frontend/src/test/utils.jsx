import { render } from "@testing-library/react";
import { PreferencesProvider } from "../context/PreferencesContext";
import { ThemeProvider } from "../context/ThemeContext";

/** matchMedia stub whose "change" listeners can be fired from tests. */
export function installMatchMedia({ dark = false, reducedMotion = false } = {}) {
  const lists = new Map();
  const state = { dark, reducedMotion };
  const matchesFor = (query) => {
    if (query.includes("prefers-color-scheme: dark")) return state.dark;
    if (query.includes("prefers-reduced-motion")) return state.reducedMotion;
    if (query.includes("min-width")) return true;
    return false;
  };
  window.matchMedia = (query) => {
    if (!lists.has(query)) {
      const listeners = new Set();
      lists.set(query, {
        media: query,
        get matches() {
          return matchesFor(query);
        },
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
        listeners,
      });
    }
    return lists.get(query);
  };
  return {
    setDark(value) {
      state.dark = value;
      for (const [query, list] of lists) {
        if (query.includes("prefers-color-scheme: dark")) list.listeners.forEach((listener) => listener({ matches: value, media: query }));
      }
    },
  };
}

export function renderWithProviders(ui) {
  return render(
    <ThemeProvider>
      <PreferencesProvider>{ui}</PreferencesProvider>
    </ThemeProvider>
  );
}
