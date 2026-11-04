// Review Desk server: node review/server.mjs  ->  http://localhost:3018
// Serves the review page, the live Remotion composition (bundled with esbuild), the public/ media
// (with Range support for video), the timeline manifest, and saves requests/comments for Claude.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { buildManifest } from "./manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PUBLIC = path.join(ROOT, "public");
// Config: review/review.config.json, or another file:  node review/server.mjs --config review/review.skill.config.json --port 3019
// (or the env vars REVIEW_CONFIG and PORT).
const argOf = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : undefined; };
const CONFIG_FILE = path.resolve(ROOT, argOf("config") || process.env.REVIEW_CONFIG || "review/review.config.json");
let CONFIG = {};
try { CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
const SLUG = CONFIG.slug || ""; // "" keeps the original paths (review/requests, review/comments.json)
const REQ_DIR = SLUG ? path.join(HERE, "requests", SLUG) : path.join(HERE, "requests");
const COMMENTS = SLUG ? path.join(HERE, `comments.${SLUG}.json`) : path.join(HERE, "comments.json");
const PORT = Number(argOf("port") || process.env.PORT || 3018);
fs.mkdirSync(REQ_DIR, { recursive: true });

// The composition the player shows: defaults to Main from src/Main.tsx, or config.target = { module, component, mix, id }.
const TARGET = { module: "src/Main", component: "Main", mix: "DEFAULT_MIX", id: "Main", ...(CONFIG.target || {}) };
const targetPlugin = {
  name: "review-target",
  setup(b) {
    b.onResolve({ filter: /^review-target$/ }, () => ({ path: "review-target", namespace: "rt" }));
    b.onLoad({ filter: /.*/, namespace: "rt" }, () => ({
      contents: `export { ${TARGET.component} as Component, ${TARGET.mix} as MIX } from ${JSON.stringify("./" + TARGET.module.split("\\").join("/"))};
export const COMPOSITION = ${JSON.stringify(TARGET.id)};`,
      resolveDir: ROOT,
      loader: "ts",
    }));
  },
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".jpg": "image/jpeg", ".png": "image/png", ".ttf": "font/ttf", ".woff2": "font/woff2" };

let bundle = { code: "", stamp: 0 };
const srcStamp = () => {
  let m = 0;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else m = Math.max(m, fs.statSync(p).mtimeMs);
  });
  walk(path.join(ROOT, "src"));
  m = Math.max(m, fs.statSync(path.join(HERE, "app.tsx")).mtimeMs);
  try { m = Math.max(m, fs.statSync(CONFIG_FILE).mtimeMs); } catch {}
  return m;
};
const getBundle = async () => {
  const st = srcStamp();
  if (bundle.code && st === bundle.stamp) return bundle.code;
  const r = await esbuild.build({
    entryPoints: [path.join(HERE, "app.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    minify: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".json": "json" },
    plugins: [targetPlugin],
    logLevel: "silent",
  });
  bundle = { code: r.outputFiles[0].text, stamp: st };
  console.log("bundled app.js", (bundle.code.length / 1e6).toFixed(1), "MB");
  return bundle.code;
};

const sendFile = (req, res, file) => {
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? +m[2] : stat.size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
  fs.createReadStream(file).pipe(res);
};

const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });
const json = (res, obj, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/" || url === "/index.html") return sendFile(req, res, path.join(HERE, "index.html"));
    if (url === "/app.js") {
      const code = await getBundle();
      res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
      return res.end(code);
    }
    if (url === "/api/manifest") return json(res, buildManifest(ROOT, CONFIG));
    if (url === "/api/comments" && req.method === "GET") return json(res, fs.existsSync(COMMENTS) ? JSON.parse(fs.readFileSync(COMMENTS, "utf8")) : []);
    if (url === "/api/comments" && req.method === "POST") {
      fs.writeFileSync(COMMENTS, await readBody(req));
      return json(res, { ok: true });
    }
    if (url === "/api/request" && req.method === "POST") {
      const { markdown } = JSON.parse(await readBody(req));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const f = path.join(REQ_DIR, `request-${stamp}.md`);
      fs.writeFileSync(f, markdown, "utf8");
      fs.writeFileSync(path.join(REQ_DIR, "latest.md"), markdown, "utf8");
      return json(res, { ok: true, file: f, latest: path.join(REQ_DIR, "latest.md") });
    }
    if (url.startsWith("/public/")) {
      const f = path.normalize(path.join(PUBLIC, url.slice(8)));
      if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
      return sendFile(req, res, f);
    }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end(String(e && e.message));
  }
}).listen(PORT, () => console.log(`Review Desk ready on http://localhost:${PORT}`));
