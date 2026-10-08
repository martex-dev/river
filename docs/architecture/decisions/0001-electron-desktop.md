# 0001 — Electron + React for the desktop client

**Status:** accepted (0.0.1)

**Context.** River needs WebRTC calls and screen sharing, consistent rendering
on Windows/macOS/Linux, native modules (libsignal, SQLCipher), and mature
auto-update and packaging. Candidates: Electron, Tauri, Qt, Flutter.

**Decision.** Electron with a sandboxed React renderer; all privileged work in
the main process.

**Consequences.** Larger download and memory footprint than Tauri. One
Chromium everywhere means identical WebRTC/screen capture behaviour and a single
security model to harden (CSP, sandbox, context isolation, private scheme).
Electron must be kept current; Dependabot tracks it.
