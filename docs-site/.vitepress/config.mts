// The user documentation, deployed by .github/workflows/pages.yml to
// /folio/docs/, next to the product site (site/) and the live demo (/demo/).
import { defineConfig } from "vitepress";

const SITE = "https://crazzybot.github.io/folio/";

export default defineConfig({
  title: "Folio Docs",
  description: "How to read, search and review folders of Markdown with Folio.",
  lang: "en",
  base: "/folio/docs/",
  cleanUrls: true,
  lastUpdated: true,
  // Contributor notes about the docs themselves
  srcExclude: ["README.md"],
  head: [
    ["link", { rel: "icon", href: "/folio/docs/icon.png" }],
    ["meta", { name: "theme-color", content: "#0f141d" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,500;7..72,600&family=Schibsted+Grotesk:wght@400;500;600&display=swap",
      },
    ],
  ],
  themeConfig: {
    logo: "/icon.png",
    siteTitle: "Folio",
    nav: [
      { text: "Guide", link: "/guide/what-is-folio", activeMatch: "/guide/" },
      { text: "Reference", link: "/reference/shortcuts", activeMatch: "/reference/" },
      { text: "FAQ", link: "/faq" },
      { text: "Live demo", link: `${SITE}demo/` },
      { text: "Download", link: `${SITE}download.html` },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is Folio?", link: "/guide/what-is-folio" },
          { text: "Getting started", link: "/guide/getting-started" },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "Reading a folder of docs", link: "/guide/reading" },
          { text: "Highlights, notes and bookmarks", link: "/guide/marking-up" },
          { text: "Reviewing specs with a coding agent", link: "/guide/review-loop" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Keyboard shortcuts", link: "/reference/shortcuts" },
          { text: "Markdown support", link: "/reference/markdown" },
        ],
      },
      { text: "FAQ", link: "/faq" },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/crazzybot/folio" }],
    editLink: {
      pattern: "https://github.com/crazzybot/folio/edit/main/docs-site/:path",
      text: "Edit this page on GitHub",
    },
    search: { provider: "local" },
    outline: { level: [2, 3] },
    footer: {
      message: 'Free and open source under the <a href="https://github.com/crazzybot/folio/blob/main/LICENSE">MIT License</a>.',
    },
  },
});
