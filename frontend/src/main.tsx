import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import { applyInitialTheme } from "./theme";
import "./index.css";

applyInitialTheme();

// The live demo is static files on GitHub Pages, which has no fallback to
// index.html for app URLs in a subfolder: it keeps its routes in the hash
// (…/demo/#/doc/…), so a reload or a shared link still works. It opens on
// the sample repository's README.
const demo = import.meta.env.MODE === "demo";
if (demo && !window.location.hash.startsWith("#/doc/")) {
  window.history.replaceState(null, "", "#/doc/" + encodeURIComponent(__DEMO_START__));
}
const Router = demo ? HashRouter : BrowserRouter;

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
);
