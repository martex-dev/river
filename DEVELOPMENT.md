# Developing River

## Requirements

- Node.js **24** or newer (includes npm 11)
- Git
- Windows, macOS or Linux

No other toolchains are needed for the desktop app. Native modules used by later
milestones (libsignal, SQLCipher) ship prebuilt binaries for all desktop platforms.

## First run

```bash
npm ci          # install exactly what package-lock.json pins
npm run dev     # start the desktop app with hot reload
```

## Scripts (run from the repository root)

| Command                           | Does                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Desktop app in development mode (updater disabled)                                              |
| `npm run build`                   | Production build of main, preload and renderer into `apps/desktop/out`                          |
| `npm test`                        | All unit tests (Vitest)                                                                         |
| `npm run test:e2e`                | Electron end-to-end tests (Playwright) against the production build — run `npm run build` first |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                               |
| `npm run typecheck`               | TypeScript across all workspaces                                                                |
| `npm run dist`                    | Build installers for the current OS into `apps/desktop/release`                                 |
| `npm run version:set -- 0.0.2`    | Set the version everywhere it is recorded                                                       |

Set `RIVER_SCREENSHOTS=1` when running end-to-end tests to save screenshots in
`apps/desktop/test-results/`.

## Layout

```
apps/desktop/
  src/main/         Electron main process (trusted): settings, updater, IPC, security policy
  src/preload/      contextBridge API (`window.river`)
  src/renderer/     React UI (sandboxed, no Node)
  src/shared/       Types and schemas shared by all three
  test/             Unit tests     e2e/   Playwright end-to-end tests
packages/release/   Release manifest format, Ed25519 signing/verification, channels
scripts/release/    Version, signing, changelog and key-generation scripts
```

## Rules of the codebase

- The renderer never gets Node, filesystem, network or key access. New
  capabilities go through a typed IPC handler in `src/main/ipc.ts` that
  validates its input with zod.
- Workspace packages are TypeScript source consumed directly (Node 24 strips
  types natively; Vite bundles them). Use explicit `.ts` import extensions and
  only erasable TypeScript syntax (no enums, no parameter properties).
- Every subsystem gets tests. Security-relevant code gets negative tests
  (tampering, wrong keys, traversal, malformed input).

## Testing the updater locally

Development builds never self-update. To exercise the real flow, build an
unpacked app (`npm run dist:dir -w @river/desktop`), run
`apps/desktop/release/<platform>-unpacked/River` and use Settings → Updates.
`RIVER_DEV_UPDATES=true` forces the updater on in `npm run dev`
(electron-updater then expects `apps/desktop/dev-app-update.yml`).
