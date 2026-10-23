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

## Option A: GitHub Pages

The repo is on GitHub, so this is the zero-cost option. The site is served under `/PrivateRedact/`.

1. Build with `VITE_BASE_PATH=/PrivateRedact/`.
2. Copy `dist/index.html` to `dist/404.html`, so deep links load the app (GitHub Pages has no
   rewrite rules).
3. Deploy `dist/` with `actions/upload-pages-artifact` and `actions/deploy-pages` in a workflow
   that runs after CI.

Limitation: GitHub Pages cannot set custom headers, so the `<meta>` CSP is the enforcement
(no `frame-ancestors`).

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
