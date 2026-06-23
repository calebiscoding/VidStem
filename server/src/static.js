/**
 * VidStem - Minimal static file server
 * ---------------------------------------------------------------------------
 * Serves the demo pages and the client SDK so you can try VidStem with a
 * single `npm start` and zero build tooling. It is intentionally tiny and
 * dependency-free.
 *
 * In production you would usually serve the client SDK from your own web
 * server or a CDN and run the signaling server on its own. This helper just
 * makes local development and demos frictionless.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';

// Map file extensions to MIME types so browsers interpret responses correctly.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Build a request handler that serves files from `rootDir`.
 *
 * @param {string} rootDir - absolute path files are served from.
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.rewrites] - exact URL -> file rewrites,
 *   e.g. { '/': '/examples/index.html' }.
 * @returns {(req, res) => Promise<boolean>} resolves true if it served the
 *   request, false if no matching file was found (so the caller can 404).
 */
export function createStaticHandler(rootDir, { rewrites = {} } = {}) {
  return async function handleStatic(req, res) {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (rewrites[urlPath]) urlPath = rewrites[urlPath];

      // Resolve the path and block traversal attempts (e.g. "/../../etc/passwd").
      const filePath = normalize(join(rootDir, urlPath));
      if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return true;
      }

      const info = await stat(filePath).catch(() => null);
      if (!info || !info.isFile()) return false; // not a file we can serve

      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        // Always revalidate during development so edits show up immediately.
        'Cache-Control': 'no-cache',
      });
      createReadStream(filePath).pipe(res);
      return true;
    } catch {
      return false;
    }
  };
}
