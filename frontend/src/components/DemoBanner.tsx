/**
 * DemoBanner — The strip above the live demo (`vite build --mode demo`):
 * says it's a sample repository, links back to the download, and resets the
 * demo to how a first visit finds it.
 */

import { resetDemoMarks } from "../api";
import styles from "./DemoBanner.module.css";

// The product site, one level up from the demo (…/folio/demo/ → …/folio/)
const SITE = "../";
// The site's own key in the same origin: not the demo's to clear
const SITE_KEYS = new Set(["folio.latestRelease"]);

/** Back to a first visit: the seed marks, default view settings, the README. */
async function resetDemo(): Promise<void> {
  if (!window.confirm("Reset the demo? Your highlights, notes and bookmarks will be removed.")) return;
  await resetDemoMarks();
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) {
      if (key?.startsWith("folio.") && !SITE_KEYS.has(key)) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing was kept there
  }
  window.location.replace(window.location.pathname + window.location.search);
}

export default function DemoBanner(): React.ReactElement {
  return (
    <div className={styles.banner} role="note">
      <span className={styles.label}>Demo</span>
      <span className={styles.text}>
        A sample repository. Your highlights and notes stay in this browser.
      </span>
      <span className={styles.actions}>
        <button type="button" className={styles.link} onClick={() => void resetDemo()}>
          Reset demo
        </button>
        <a className={styles.download} href={SITE}>
          Download Folio
        </a>
      </span>
    </div>
  );
}
