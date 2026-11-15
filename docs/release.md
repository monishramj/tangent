# Releasing Tangent

Pushing a `v*` tag builds installers on GitHub (`.github/workflows/release.yml`) and attaches them to a **draft** release. Nothing is published until you click Publish.

## One-time setup (owner only)
The workflow needs the updater signing key as repo secrets. Names must match exactly:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo monishramj/tangent < ~/.tauri/tangent.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo monishramj/tangent   # prompts; enter the key's password (empty if none)
```
The key must be the one whose public half is `plugins.updater.pubkey` in `tauri.conf.json`; a different key breaks updates for installed apps. Never commit it.

## Dry run (no release)
GitHub -> Actions -> Release -> Run workflow (pick the branch). All four builds run; installers land as workflow artifacts (3 days). Do this before the first real tag and after any packaging change.

## Cut a release
1. Set the new `X.Y.Z` in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (then `cargo update -p tangent --offline` or let `Cargo.lock` refresh). Merge to the branch you release from.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` (the workflow fails fast if the tag differs from the `tauri.conf.json` version).
3. Wait for the 4 matrix jobs (about 30-60 min cold, faster with caches).
4. Open the draft (Releases page). Check the assets below, download and smoke-test at least the macOS one, edit notes.
5. Publish. Only now does `releases/latest/download/latest.json` point at the new version and the in-app updater offers it.

## What the draft contains
- macOS arm64 and x64: `.dmg`, `.app.tar.gz` + `.sig` (updater). Ad-hoc signed, **not notarized** (Gatekeeper override needed, see README).
- Windows x64: NSIS `-setup.exe` and `.msi`, each with `.sig`. Unsigned (SmartScreen warning).
- Linux x64: `.AppImage`, `.deb`, `.rpm` (+ `.sig` for the AppImage).
- `latest.json`: merged updater manifest for all platforms.
Installers are small: they bundle only uv, PDFium and sidecar sources. Python, torch (CPU wheels on Linux) and models install at first launch.

## Rollback
- Not yet published: delete the draft and the tag (`gh release delete vX.Y.Z --yes; git push origin :refs/tags/vX.Y.Z; git tag -d vX.Y.Z`), fix, retag.
- Already published and bad: mark the release as draft again (or delete it) so `latest.json` stops serving it; installed apps simply stay on their version. Ship `vX.Y.(Z+1)` with the fix. Never reuse a tag that users may have fetched.

## Local fallback
`scripts/release.sh X.Y.Z` still builds the macOS arm64 bundle locally and prints a manual `gh release create` command.

## Only a real tag run can verify
Windows/Linux builds at all; `prepare-runtime` per OS on runners (`python3` on Windows); tauri-action merging `latest.json` across 4 jobs; `macos-15-intel` runner availability; updater signature with the repo secrets; AppImage build on the runner; that an installed build actually launches and runs first-launch setup.
