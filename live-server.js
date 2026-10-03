#!/usr/bin/env node
/**
 * Local dev server with SharedArrayBuffer enabled.
 * - Serves files from the current working directory
 * - Adds the required COOP/COEP headers
 * - Opens the default browser to http://127.0.0.1:8080
 *
 * Usage:
 *   node serve-with-sharedarraybuffer.js
 *
 * Requirements:
 *   Node.js 14+ installed
 */

import http from "http";
import { readFile } from "fs/promises";
import { extname, join } from "path";
import { cwd } from "process";
import { exec } from "child_process";

const PORT = 8080;

// Map file extensions to MIME types
const mimeTypes = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".wasm": "application/wasm",
};

http
  .createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, "http://127.0.0.1");
      const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      const filePath = join(cwd(), decodeURIComponent(pathname));
      const data = await readFile(filePath);

      // MIME type based on extension
      const ext = extname(filePath).toLowerCase();
      res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
      // Development branches change core mapper scripts frequently. Never let
      // the browser silently reuse an older mapper/loader file at the same URL.
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      // === Required for SharedArrayBuffer ===
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

      res.writeHead(200);
      res.end(data);
    } catch (err) {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(PORT, () => {
    const url = `http://127.0.0.1:${PORT}/index.html`;
    console.debug(`Server running at ${url}`);

    // Auto-open default browser
    const startCmd =
      process.platform === "win32"
        ? "start"
        : process.platform === "darwin"
        ? "open"
        : "xdg-open";

    exec(`${startCmd} ${url}`);
  });
