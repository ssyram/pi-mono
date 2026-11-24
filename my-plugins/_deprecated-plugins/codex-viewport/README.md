# codex-viewport

The previous renderer has been removed.

This entrypoint is intentionally a no-op while the renderer is redesigned from first principles. It does not patch Pi, render terminal output, intercept input, alter session events, or modify AI-visible data.

See [`docs/rebuild-principles.md`](docs/rebuild-principles.md) for the current design boundary. All other documents in `docs/` are retained only as historical failure evidence; they do not describe an accepted implementation.
