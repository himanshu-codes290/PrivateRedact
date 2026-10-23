# 7. Deployment

PrivateRedact is a **static site**: `npm run build` produces `PrivateRedact/dist/`, and any static
host can serve it. There is no backend, database or environment secret.

## Build

```bash
cd PrivateRedact
npm ci
npm run build                                  # served from the domain root
VITE_BASE_PATH=/PrivateRedact/ npm run build   # served from a sub-path
```

The build includes the app, the PDF.js worker, the redaction worker, PDF.js assets under
`/pdfjs/`, a service worker (`sw.js`) and a web manifest.

## Requirements for any host

1. **SPA fallback:** unknown paths (e.g. `/redact` on refresh) must serve `index.html`.
2. **Correct MIME types:** `.wasm` must be `application/wasm`; `.mjs`/`.js` must be JavaScript.
3. **HTTPS:** service workers and `crypto.randomUUID()` require a secure context.
4. **Headers (recommended):** the CSP is already in a `<meta>` tag, but real headers are stronger
   and allow `frame-ancestors`.

Recommended headers:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```

## Option A: GitHub Pages (the live deployment)

The repo is on GitHub, so this is the zero-cost option. The site is served under `/PrivateRedact/`:
**https://himanshu-codes290.github.io/PrivateRedact/**

`.github/workflows/deploy-pages.yml` runs on every push to `main` (and on demand via
"Run workflow"):

1. `npm ci` and `npm run build` with `VITE_BASE_PATH=/<repo name>/`. Vite prefixes every asset,
   the router `basename`, the PDF.js asset URLs, the service-worker fallback and the manifest
   `start_url`/`scope` with that base.
2. Copies `dist/index.html` to `dist/404.html`, so deep links such as `/PrivateRedact/redact` load
   the app on refresh (GitHub Pages has no rewrite rules; it serves `404.html` for unknown paths).
3. `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`. The
   `deploy` job targets the `github-pages` environment, so each run's summary links to the live
   URL.

One-time setup in the repository: **Settings → Pages → Build and deployment → Source** must be
"GitHub Actions". The workflow's own token cannot create the Pages site (the first run failed at
`configure-pages` for exactly that reason), so this is a manual click, after which every push to
`main` deploys.

Limitations: GitHub Pages cannot set custom headers, so the `<meta>` CSP is the enforcement
(no `frame-ancestors`), and the site is public, which is fine because it holds no data.

Local check of a sub-path build (Git Bash on Windows rewrites `/PrivateRedact/` into a Windows
path unless path conversion is off):

```bash
MSYS_NO_PATHCONV=1 VITE_BASE_PATH=/PrivateRedact/ npm run build
npm run preview        # http://localhost:4173/PrivateRedact/
```

## Option B: Netlify or Vercel

Base path stays `/`. Netlify (`PrivateRedact/netlify.toml`):

```toml
[build]
  base = "PrivateRedact"
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "...same as above..."
    Referrer-Policy = "no-referrer"
    X-Content-Type-Options = "nosniff"
```

Vercel (`vercel.json`): set the root directory to `PrivateRedact`, add
`"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]` and a `headers` block.

## Option C: Docker with nginx

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY PrivateRedact/package*.json ./
RUN HUSKY=0 npm ci
COPY PrivateRedact/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  include /etc/nginx/mime.types;
  types { application/wasm wasm; }
  add_header Content-Security-Policy "...same as above..." always;
  add_header Referrer-Policy "no-referrer" always;
  add_header X-Content-Type-Options "nosniff" always;
  location / { try_files $uri /index.html; }
  location = /sw.js { add_header Cache-Control "no-cache"; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

## Caching

- `assets/*` file names contain content hashes, so they can be cached for a year.
- `index.html` and `sw.js` must not be cached long, or users get stale versions. The service worker
  updates itself (`registerType: 'autoUpdate'`) on the next visit.

## Post-deploy checklist

- [ ] `/redact` loads directly (SPA fallback works).
- [ ] DevTools Network tab: no request to any other origin while redacting.
- [ ] DevTools Console: no CSP violations.
- [ ] Application tab: the service worker is active; reload with the network offline still works.
- [ ] Redact a test PDF and confirm the "Verified" badge.
