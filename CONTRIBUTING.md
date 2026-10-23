# Contributing

1. Use Node 22.22+ (`nvm use`).
2. `cd PrivateRedact && npm ci` (installs a pre-commit hook that lints and formats staged files).
3. Make the change. If it touches the redaction engine, add a regression test in
   `src/features/redact/engine/__tests__/` that builds a PDF reproducing the case and asserts with
   `findLeaks()` that nothing under a box survives.
4. Run `npm run check` before opening a pull request. CI runs the same steps.

See [docs/08-testing.md](docs/08-testing.md) for how the tests are organised.
