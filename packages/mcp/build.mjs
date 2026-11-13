// Bundles the server, the core and the MCP SDK into one file, dist/folio-mcp.mjs,
// so `npx @crazzybot/folio-mcp` installs no dependencies. The bundled
// packages' licenses go beside it, in dist/THIRD_PARTY_LICENSES.txt.
import { build } from "esbuild";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

const { metafile } = await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/folio-mcp.mjs",
  bundle: true,
  platform: "node",
  target: "node20.19",
  format: "esm",
  define: { FOLIO_MCP_VERSION: JSON.stringify(version) },
  // A CommonJS dependency's require() needs one in an ES module
  banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "none",
  metafile: true,
  logLevel: "info",
});

// Each bundled package once: node_modules/<name> or node_modules/@scope/<name>
const packages = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (match) packages.add(match[1]);
}
const notices = [...packages].sort().map((name) => {
  const folder = path.join("node_modules", name);
  const { version: v, license } = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8"));
  const file = readdirSync(folder).find((f) => /^licen[cs]e/i.test(f));
  if (file === undefined || !existsSync(path.join(folder, file))) throw new Error(`No license file in ${folder}`);
  return `${name} ${v} (${license})\n\n${readFileSync(path.join(folder, file), "utf8").trim()}\n`;
});
writeFileSync("dist/THIRD_PARTY_LICENSES.txt", notices.join(`\n${"-".repeat(72)}\n\n`));
console.log(`  dist/THIRD_PARTY_LICENSES.txt  ${packages.size} packages: ${[...packages].sort().join(", ")}`);
