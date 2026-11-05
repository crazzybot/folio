import { useCallback, useEffect, useState } from "react";

/**
 * Light / dark appearance. The chosen palette is applied as
 * <html data-theme="light|dark"> (see index.css); "system" follows
 * prefers-color-scheme.
 *
 * In the desktop app the preference lives in settings.json, shared with
 * View → Appearance, and Electron's nativeTheme makes prefers-color-scheme
 * report it, so the page always resolves through the media query there. In
 * the browser it is remembered in localStorage.
 */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_OPTIONS: readonly { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const STORAGE_KEY = "folio.theme";
const desktopApi = window.markdownApi;
const lightQuery = window.matchMedia("(prefers-color-scheme: light)");

function isPreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

function loadBrowserPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isPreference(saved)) return saved;
  } catch {
    // Storage unavailable: follow the system
  }
  return "system";
}

function apply(preference: ThemePreference): void {
  const light = desktopApi || preference === "system" ? lightQuery.matches : preference === "light";
  document.documentElement.dataset["theme"] = light ? "light" : "dark";
}

/** Set the palette before the first render, so the page doesn't flash the other theme. */
export function applyInitialTheme(): void {
  apply(desktopApi ? "system" : loadBrowserPreference());
}

/** The theme preference and a setter; keeps <html data-theme> in sync. */
export default function useTheme(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(desktopApi ? "system" : loadBrowserPreference);

  // Desktop: the setting can also change from the menu or settings.json
  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void desktopApi.getTheme().then((theme) => {
      if (!cancelled && isPreference(theme)) setPreference(theme);
    });
    const unsubscribe = desktopApi.onThemeChange((theme) => {
      if (isPreference(theme)) setPreference(theme);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Re-resolve when the preference or the system appearance changes
  useEffect(() => {
    apply(preference);
    const onChange = () => apply(preference);
    lightQuery.addEventListener("change", onChange);
    return () => lightQuery.removeEventListener("change", onChange);
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    if (desktopApi) {
      void desktopApi.setTheme(next);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered, but still applied
    }
  }, []);

  return [preference, choose];
}

/** The palette in use ("light" or "dark"), following <html data-theme>. */
export function useAppliedTheme(): "light" | "dark" {
  const read = () => (document.documentElement.dataset["theme"] === "light" ? "light" : "dark");
  const [applied, setApplied] = useState<"light" | "dark">(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setApplied(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return applied;
}
