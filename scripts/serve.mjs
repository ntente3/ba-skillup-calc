/**
 * Static server for development.
 *
 * The app has no build step, but it still cannot be opened over file:// — the browser
 * blocks ES module imports and fetch as cross-origin. Hence the local server.
 *
 * Node rather than python: by the time anyone types `npm run dev`, node is certain to be
 * there, python may not be, and on Windows the command is `python`/`py` rather than
 * `python3`, so it differs from platform to platform. No dependency is added either —
 * node standard modules only.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve(process.argv[3] || ".");
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";

    // Block paths that lead outside the root (../ and the like).
    const target = resolve(join(ROOT, normalize(path)));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
         .end(`404 ${path}`);
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",   // so an edited file shows up right away
    }).end(body);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(e));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Skill-up calculator → http://localhost:${PORT}\n`);
  console.log(`  root: ${ROOT}`);
  console.log(`  stop: Ctrl+C\n`);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Use another port: npm run dev -- 8081\n`);
    process.exit(1);
  }
  throw e;
});
