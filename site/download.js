// Points every download link on the page at the latest GitHub Release, and
// picks the build for the visitor's computer.
//
//   [data-build="mac-arm"]       href → that build's file
//   [data-file="mac-arm"]        text → its file name and size
//   [data-primary]               the main button: [data-label] / [data-detail] inside
//   [data-alt]                   "Intel Mac?" style link for an uncertain guess
//   [data-version]               text → "Version 0.1.0, released 6 November 2026"
//   [data-status]                shown when there's no release to offer
//   .build[data-key]             the matching row gets .is-yours
//
// The main buttons download this computer's build straight away, or else go
// to download.html, never to GitHub's releases page (its installers sit in a
// collapsed Assets section). Builds on download.html with no file to offer
// are marked unavailable; only when GitHub can't be reached do they fall
// back to the releases page.

const REPO = "crazzybot/folio";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const CACHE_KEY = "folio.latestRelease";
const CACHE_MS = 10 * 60 * 1000;

// File names come from electron-builder's defaults, e.g. Folio-0.1.0-arm64.dmg,
// Folio-0.1.0.dmg (Intel), Folio-Setup-0.1.0.exe, Folio-0.1.0.AppImage.
const BUILDS = {
  "mac-arm": { os: "macOS", detail: "Apple Silicon", match: (n) => /arm64\.dmg$/i.test(n) },
  "mac-intel": { os: "macOS", detail: "Intel", match: (n) => /\.dmg$/i.test(n) && !/arm64/i.test(n) },
  win: { os: "Windows", detail: "64-bit installer", match: (n) => /\.exe$/i.test(n) },
  linux: { os: "Linux", detail: "AppImage, x64", match: (n) => /\.AppImage$/i.test(n) && !/arm64|aarch64/i.test(n) },
};

/** The build for this computer: { key, sure }, or null on phones and unknown systems. */
async function detectBuild() {
  const ua = navigator.userAgent;
  const uaData = navigator.userAgentData;
  const platform = uaData?.platform ?? "";

  if (/Android|iPhone|iPad|iPod/i.test(ua) || uaData?.mobile) return null;
  // iPadOS reports itself as a Mac; a touch screen gives it away
  if (/Mac/i.test(ua) && navigator.maxTouchPoints > 1) return null;

  if (platform === "Windows" || /Windows/i.test(ua)) return { key: "win", sure: true };
  if (platform === "macOS" || /Macintosh|Mac OS X/i.test(ua)) {
    // Chromium browsers can tell Apple Silicon from Intel; Safari and Firefox
    // always say "Intel", so default to Apple Silicon and offer the other.
    try {
      const { architecture } = await uaData.getHighEntropyValues(["architecture"]);
      if (architecture === "arm") return { key: "mac-arm", sure: true };
      if (architecture === "x86") return { key: "mac-intel", sure: true };
    } catch {
      // No userAgentData: fall through to the guess
    }
    return { key: "mac-arm", sure: false };
  }
  if (platform === "Linux" || /Linux|X11/i.test(ua)) return { key: "linux", sure: true };
  return null;
}

/** The latest published release, null if there is none, undefined if GitHub can't be reached. */
async function latestRelease() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.release;
  } catch {
    // Storage unavailable or empty
  }
  let release = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      const data = await res.json();
      release = {
        version: data.tag_name.replace(/^v/, ""),
        date: data.published_at,
        assets: data.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
      };
    } else if (res.status !== 404) {
      return undefined; // rate limited or down: don't cache
    }
  } catch {
    return undefined;
  }
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }));
  } catch {
    // Storage unavailable
  }
  return release;
}

function formatSize(bytes) {
  return `${Math.round(bytes / 1e6)} MB`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function setText(selector, text) {
  for (const el of document.querySelectorAll(selector)) el.textContent = text;
}

async function init() {
  const [build, release] = await Promise.all([detectBuild(), latestRelease()]);

  const files = {};
  for (const [key, b] of Object.entries(BUILDS)) {
    files[key] = release?.assets.find((a) => b.match(a.name)) ?? null;
  }

  for (const el of document.querySelectorAll("[data-build]")) {
    const file = files[el.dataset.build];
    if (file) {
      el.href = file.url;
    } else if (release === undefined) {
      el.href = RELEASES_PAGE;
    } else {
      el.removeAttribute("href");
      el.setAttribute("aria-disabled", "true");
      el.textContent = "Not available yet";
    }
  }
  for (const el of document.querySelectorAll("[data-file]")) {
    const file = files[el.dataset.file];
    if (file) el.textContent = `${file.name}, ${formatSize(file.size)}`;
  }

  if (release) {
    setText("[data-version]", `Version ${release.version}, released ${formatDate(release.date)}`);
  } else if (release === null) {
    for (const el of document.querySelectorAll("[data-status]")) el.hidden = false;
  }

  if (build) {
    for (const row of document.querySelectorAll(`.build[data-key="${build.key}"]`)) {
      row.classList.add("is-yours");
      if (!build.sure) row.querySelector(".yours-note").textContent = "Most likely your Mac";
    }
  }

  const ownFile = build && files[build.key];
  for (const button of document.querySelectorAll("[data-primary]")) {
    const label = button.querySelector("[data-label]");
    const detail = button.querySelector("[data-detail]");
    if (ownFile) {
      const b = BUILDS[build.key];
      button.href = ownFile.url;
      label.textContent = `Download for ${b.os}`;
      detail.textContent = `${b.detail}, version ${release.version}`;
    }
    // Otherwise (no release yet, phones, unknown systems) it keeps pointing at download.html
  }

  // An uncertain Mac guess gets a link to the other Mac build
  if (build && !build.sure && files["mac-intel"]) {
    for (const el of document.querySelectorAll("[data-alt]")) {
      const link = el.querySelector("a");
      link.href = files["mac-intel"].url;
      el.hidden = false;
    }
  }
}

init();
