import { useEffect } from "react";

/**
 * Desktop app: applies the user's custom.css (View → Edit Custom CSS…) as a
 * <style> element at the end of <head>, so it overrides the built-in
 * document styles; updated whenever the file is saved.
 */
export default function useCustomCss(): void {
  useEffect(() => {
    const api = window.markdownApi;
    if (!api) return;

    const apply = (css: string | null) => {
      let style = document.getElementById("folio-custom-css") as HTMLStyleElement | null;
      if (css === null || css.trim() === "") {
        style?.remove();
        return;
      }
      if (style === null) {
        style = document.createElement("style");
        style.id = "folio-custom-css";
      }
      // (Re-)appended so it stays last, after any styles loaded since
      document.head.appendChild(style);
      style.textContent = css;
    };

    let cancelled = false;
    void api.getCustomCss().then((css) => {
      if (!cancelled) apply(css);
    });
    const unsubscribe = api.onCustomCssChange(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
