# PrivateRedact documentation

These documents explain what PrivateRedact is, how it is built, and why it is built that way. They
are written so you can study the project end to end and talk about it confidently in a technical
interview, and they double as onboarding notes for anyone working on the code.

## Reading order

| #   | Document                                                       | Read it to…                                                                     |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | [Project overview](01-project-overview.md)                     | Pitch the project: the problem, the user flow, the privacy model, the limits.   |
| 2   | [Architecture](02-architecture.md)                             | Draw the system on a whiteboard: threads, data flow, state, coordinate systems. |
| 3   | [Tech stack](03-tech-stack.md)                                 | Justify every library and tool, with the alternatives you rejected.             |
| 4   | [Redaction engine deep dive](04-redaction-engine-deep-dive.md) | Explain the hard part: how text is located and removed inside a PDF.            |
| 5   | [Interview Q&A](05-interview-qa.md)                            | Rehearse answers to the questions you are most likely to get.                   |
| 6   | [Audit and changes](06-audit-and-changes.md)                   | Tell the "I found and fixed real bugs" story with evidence.                     |
| 7   | [Deployment](07-deployment.md)                                 | Ship it: static hosting options, headers, sub-path builds.                      |
| 8   | [Testing](08-testing.md)                                       | Explain the test strategy and how to add a regression test.                     |

The original design plan is kept in [archive/](archive/redact-workspace-plan.md) for history.

## One-paragraph summary

PrivateRedact is a client-side PDF redaction web app. You open PDFs, draw boxes (or select text) on
any page, and the app produces a copy where everything under the boxes is **deleted from the file**,
not merely covered. All work happens in the browser: React renders the UI, PDF.js renders pages,
Fabric.js handles drawing, and a custom redaction engine built on pdf-lib rewrites the PDF inside a
Web Worker. A second, independent parser (PDF.js) then re-reads the output to verify that no text is
left under any box. There is no backend, a Content-Security-Policy blocks outbound requests, and the
app works offline as a PWA.
