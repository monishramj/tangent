#!/usr/bin/env python3
"""Fetch only pinned, SHA256-verified native assets; never install ML packages."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
# Checksummed like the binaries; update with the uv version.
UV_LICENSES = {
    'UV-LICENSE-MIT': {'url': 'https://raw.githubusercontent.com/astral-sh/uv/0.12.19/LICENSE-MIT',
                       'sha256': '860e3d7a86b84e6a7012c7a635fc64df475cebc6cce34dfeb73a5982ec58176c'},
    'UV-LICENSE-APACHE': {'url': 'https://raw.githubusercontent.com/astral-sh/uv/0.12.19/LICENSE-APACHE',
                          'sha256': 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'},
}


def unpack(data, suffix, destination, wanted):
    archive = zipfile.ZipFile(io.BytesIO(data)) if suffix == '.zip' else tarfile.open(fileobj=io.BytesIO(data), mode='r:gz')
    found = set()
    with archive:
        for item in archive.infolist() if suffix == '.zip' else archive.getmembers():
            name = item.filename if suffix == '.zip' else item.name
            base = Path(name).name
            if base not in wanted:
                continue
            stream = archive.open(item) if suffix == '.zip' else archive.extractfile(item)
            if stream is not None:
                with stream:
                    (destination / base).write_bytes(stream.read())
                found.add(base)
    if not wanted <= found:
        raise ValueError(f'Missing archive members: {wanted - found}')


def fetch(asset):
    with urllib.request.urlopen(asset['url'], timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise ValueError(f"Checksum mismatch: {asset['url']}")
    return data


def main():
    target = os.environ.get('TAURI_ENV_TARGET_TRIPLE') or subprocess.check_output(['rustc', '-vV'], text=True).split('host: ')[1].splitlines()[0]
    assets = json.loads((ROOT / 'scripts/runtime-assets.json').read_text())[target]
    destination = ROOT / 'src-tauri/resources/runtime'
    destination.mkdir(parents=True, exist_ok=True)
    # Fail closed: stale assets from another target must never enter an installer.
    for name in ('uv', 'uv.exe', 'libpdfium.dylib', 'libpdfium.so', 'pdfium.dll'):
        (destination / name).unlink(missing_ok=True)
    uv_name = 'uv.exe' if 'windows' in target else 'uv'
    pdf_name = 'pdfium.dll' if 'windows' in target else 'libpdfium.dylib' if 'apple' in target else 'libpdfium.so'
    unpack(fetch(assets['uv']), '.zip' if 'windows' in target else '.tgz', destination, {uv_name})
    pdf = fetch(assets['pdfium'])
    unpack(pdf, '.tgz', destination, {pdf_name})
    (destination / uv_name).chmod(0o755)
    project = destination / 'sidecar'
    if project.exists():
        shutil.rmtree(project)
    project.mkdir()
    for name in ('pyproject.toml', 'uv.lock'):
        shutil.copy2(ROOT / 'sidecar' / name, project / name)
    shutil.copytree(ROOT / 'sidecar/tangent_sidecar', project / 'tangent_sidecar', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    # Preserve upstream licences in the installer, alongside their binaries.
    for name, asset in UV_LICENSES.items():
        (destination / name).write_bytes(fetch(asset))
    with tarfile.open(fileobj=io.BytesIO(pdf), mode='r:gz') as archive:
        for item in archive.getmembers():
            if item.isfile() and ('LICENSE' in item.name.upper() or 'licenses/' in item.name):
                with archive.extractfile(item) as stream:
                    path = destination / 'pdfium-licenses' / item.name.replace('..', '_').lstrip('/')
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(stream.read())
    print(f'Prepared uv 0.12.19 + PDFium chromium/8152 + sidecar for {target}')


if __name__ == '__main__':
    main()
