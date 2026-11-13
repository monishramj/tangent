#!/usr/bin/env bash
# Builds locally; publishing is always a separately printed, explicit command.
set -euo pipefail
cd "$(dirname "$0")/.."
version=${1:?Usage: scripts/release.sh X.Y.Z [--dry-run]}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Use an X.Y.Z version' >&2; exit 1; }
if [[ ${2:-} == --dry-run ]]; then
  printf 'Would bump package.json, Cargo.toml and tauri.conf.json to %s, build app + dmg + signed updater, and print gh release create (never publish).\n' "$version"
  exit 0
fi
[[ $# == 1 ]] || { echo 'Unknown arguments' >&2; exit 1; }
: "${TAURI_SIGNING_PRIVATE_KEY:?Set this to ~/.tauri/tangent.key (or its contents)}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}
export TANGENT_SIDECAR_DIR=${TANGENT_SIDECAR_DIR:-"$PWD/sidecar"}
[[ -f "$TANGENT_SIDECAR_DIR/pyproject.toml" && -d "$TANGENT_SIDECAR_DIR/.venv" ]] || {
  echo 'Set TANGENT_SIDECAR_DIR to the stable sidecar project with its installed .venv' >&2; exit 1;
}
python3 - "$version" <<'PY'
import json, pathlib, re, sys
version = sys.argv[1]
for name in ('package.json', 'src-tauri/tauri.conf.json'):
    p = pathlib.Path(name)
    data = json.loads(p.read_text())
    if tuple(map(int, version.split('.'))) < tuple(map(int, data['version'].split('.'))):
        raise SystemExit('Release version must not be older than the current version')
    data['version'] = version
    p.write_text(json.dumps(data, indent=2) + '\n')
p = pathlib.Path('src-tauri/Cargo.toml')
p.write_text(re.sub(r'^version = "[^"]+"', f'version = "{version}"', p.read_text(), count=1, flags=re.M))
PY
# Skip Finder automation for the disk image; keep builds within the shared CPU budget.
CI=true CARGO_BUILD_JOBS=3 nice -n 10 bunx tauri build --bundles app,dmg
python3 - "$version" <<'PY'
import datetime, json, pathlib, sys
root = pathlib.Path('src-tauri/target/release/bundle')
archive = root / 'macos/Tangent.app.tar.gz'
signature = pathlib.Path(str(archive) + '.sig')
assert (root / 'macos/Tangent.app/Contents/MacOS/Tangent').is_file()
assert archive.is_file() and signature.is_file()
assert list((root / 'dmg').glob('*.dmg'))
manifest = {'version': sys.argv[1], 'notes': f'Tangent {sys.argv[1]}',
    'pub_date': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'platforms': {'darwin-aarch64': {'signature': signature.read_text().strip(),
        'url': f'https://github.com/monishramj/tangent/releases/download/v{sys.argv[1]}/{archive.name}'}}}
(root / 'latest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Verified app, dmg, updater archive + signature, and latest.json:', root.resolve())
PY
printf '\nReview and commit the version changes, push the commit, then publish manually:\n'
printf 'gh release create v%s --repo monishramj/tangent --target "$(git rev-parse HEAD)" --title "Tangent %s" --generate-notes src-tauri/target/release/bundle/latest.json src-tauri/target/release/bundle/macos/Tangent.app.tar.gz{,.sig} src-tauri/target/release/bundle/dmg/*.dmg\n' "$version" "$version"
