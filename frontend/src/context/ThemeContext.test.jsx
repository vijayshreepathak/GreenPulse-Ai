import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeToggle from "../components/layout/ThemeToggle";
import { STORAGE_KEYS } from "../lib/storage";
import { installMatchMedia } from "../test/utils";
import { ThemeProvider, useTheme } from "./ThemeContext";

function PreferenceProbe() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setPreference("system")}>Use system</button>
    </div>
  );
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
      <PreferenceProbe />
    </ThemeProvider>
  );
}

describe("theme system", () => {
  let media;
  beforeEach(() => {
    media = installMatchMedia({ dark: false });
  });
  afterEach(() => vi.restoreAllMocks());

  it("initialises from the saved preference and applies it to the document", () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, "dark");
    renderTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark mode" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches theme with a single click and persists it", () => {
    renderTheme();
    const toggle = screen.getByRole("button", { name: "Dark mode" });
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(STORAGE_KEYS.theme)).toBe("dark");
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEYS.theme)).toBe("light");
  });

  it("follows operating-system changes while System is selected", () => {
    renderTheme();
    fireEvent.click(screen.getByRole("button", { name: "Use system" }));
    expect(screen.getByTestId("preference")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    act(() => media.setDark(true));
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores OS changes once an explicit theme is chosen", () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, "light");
    renderTheme();
    act(() => media.setDark(true));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("toggles from the effective system theme in one click", () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, "system");
    media.setDark(true);
    renderTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("works when localStorage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderTheme();
    expect(screen.getByTestId("preference")).toHaveTextContent("system");
    fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("falls back to System for an invalid stored value", () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, "purple");
    renderTheme();
    expect(screen.getByTestId("preference")).toHaveTextContent("system");
  });
});
