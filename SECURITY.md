# Security policy

PrivateRedact is a redaction tool, so a "security bug" includes any case where content that was
inside a redaction box can still be recovered from the output file.

## Threat model

**Protected against**

- Redacted text being copied, searched or extracted from the output (it is deleted from the
  content streams, including inside Form XObjects).
- Leaks through PDF side channels: annotations, form field values, document info, XMP metadata,
  bookmarks, attachments, JavaScript, page thumbnails, structure-tree alternate text, and
  unreachable objects from earlier revisions.
- Documents leaving the device: there is no backend, and a Content-Security-Policy restricts
  network access to the app's own origin.
- Malformed or hostile PDFs hanging the tab: the content-stream parser always makes progress, and
  every job runs in a Web Worker with a watchdog timeout and a Cancel button.

**Not protected against (documented limits)**

- Pixels of an image that is only partly covered by a box. The covered area is painted black but
  the full image stays in the file. The app warns about this case.
- Scanned pages and text drawn as vector outlines: covered, not removed. The app warns.
- Encrypted PDFs: refused. Remove the protection first.
- Inference from context, layout or text length around a redaction.
- A compromised browser, extension or operating system.

## Reporting a vulnerability

Open a private security advisory on GitHub (Security tab, "Report a vulnerability"). If the issue
is a leak, attach a PDF that reproduces it **with dummy data only** and the boxes you drew.
