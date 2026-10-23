import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Serves PDF.js runtime assets (CMaps, standard fonts, WASM image decoders,
 * ICC profiles) from the app's own origin under `<base>pdfjs/`.
 *
 * Keeping them same-origin means the production CSP can stay at
 * `connect-src 'self'`: no CDN, no third-party request, works offline.
 *   - dev:   streamed straight from node_modules by a middleware
 *   - build: emitted as static assets into dist/pdfjs/
 */
const ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const SKIP = /(^LICENSE|\.md$|quickjs)/;

const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/vnd.iccprofile',
  '.js': 'text/javascript',
};

function listFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => !SKIP.test(f) && statSync(path.join(dir, f)).isFile());
}

export function pdfjsAssets(root: string): Plugin {
  const pkgDir = path.join(root, 'node_modules', 'pdfjs-dist');

  return {
    name: 'privateredact:pdfjs-assets',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const prefix = `${server.config.base}pdfjs/`;
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith(prefix)) return next();
        const [dir, file] = decodeURIComponent(url.slice(prefix.length)).split('/');
        if (!dir || !file || !ASSET_DIRS.includes(dir) || SKIP.test(file)) return next();
        const abs = path.join(pkgDir, dir, path.basename(file));
        if (!existsSync(abs)) return next();
        res.setHeader('Content-Type', MIME[path.extname(abs)] ?? 'application/octet-stream');
        createReadStream(abs).pipe(res);
      });
    },

    generateBundle() {
      for (const dir of ASSET_DIRS) {
        const abs = path.join(pkgDir, dir);
        if (!existsSync(abs)) continue;
        for (const file of listFiles(abs)) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir}/${file}`,
            source: readFileSync(path.join(abs, file)),
          });
        }
      }
    },
  };
}
