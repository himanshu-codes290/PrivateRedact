# PrivateRedact

Permanently redact PDFs **in your browser**. Mark what to hide, and PrivateRedact deletes it from the
file itself, not just paints a black box over it. Nothing is uploaded: there is no server.

[![CI](https://github.com/himanshu-codes290/PrivateRedact/actions/workflows/ci.yml/badge.svg)](https://github.com/himanshu-codes290/PrivateRedact/actions/workflows/ci.yml)
[![Deploy](https://github.com/himanshu-codes290/PrivateRedact/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/himanshu-codes290/PrivateRedact/actions/workflows/deploy-pages.yml)

**Live:** https://himanshu-codes290.github.io/PrivateRedact/

## What it does

- **Removes, not covers.** Text under a box is deleted glyph by glyph from the PDF content streams.
  Text next to the box keeps its exact position.
- **Goes beyond page text.** Text inside reusable form objects, images fully inside a box,
  touching annotations and form fields, metadata, bookmarks, attachments and JavaScript are removed.
- **Checks its own work.** The output is re-opened with a second, independent PDF engine (PDF.js) to
  confirm no extractable text remains under any box.
- **Honest about limits.** Partly covered images and scanned pages are flagged, not silently "done".
- **Private by construction.** Everything runs client-side in a Web Worker; a Content-Security-Policy
  blocks network requests to anything but the app's own origin; works offline as an installable PWA.

## Quick start

Requires Node.js 22.22 or newer (see `.nvmrc`).

```bash
cd PrivateRedact
npm ci
npm run dev        # http://localhost:5173
npm run check      # format, lint, typecheck, tests, production build
```

## Repository layout

| Path                       | What is there                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `PrivateRedact/`           | The web app (React 19, TypeScript, Vite 8). Developer notes in its README.                 |
| `docs/`                    | Project documentation: architecture, tech stack, engine deep dive, interview guide, audit. |
| `.github/workflows/ci.yml` | CI: format, lint, typecheck, tests with coverage, build.                                   |
| `SECURITY.md`              | Threat model and how to report a redaction leak.                                           |

## Documentation

Start with [docs/README.md](docs/README.md).

## Licence

[MIT](LICENSE)
