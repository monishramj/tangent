import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import tomllib
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('prepare_runtime', Path(__file__).with_name('prepare-runtime.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class RuntimeAssetsTest(unittest.TestCase):
    def test_linux_torch_is_cpu_only_and_other_platform_pins_stay_the_same(self):
        lock = tomllib.loads((prepare.ROOT / 'sidecar/uv.lock').read_text())
        for name, version in [('torch', '2.15.0'), ('torchaudio', '2.11.1')]:
            packages = [p for p in lock['package'] if p['name'] == name]
            self.assertEqual({p['version'] for p in packages}, {version, version + '+cpu'})
            cpu = next(p for p in packages if p['version'].endswith('+cpu'))
            self.assertEqual(cpu['source']['registry'], 'https://download.pytorch.org/whl/cpu')
        self.assertFalse(any(p['name'].startswith(('nvidia-', 'cuda-')) for p in lock['package']))

    def test_checksum_is_required(self):
        data = b'fake binary'
        with patch.object(prepare.urllib.request, 'urlopen', return_value=io.BytesIO(data)):
            self.assertEqual(prepare.fetch({'url': 'https://example.invalid/uv', 'sha256': hashlib.sha256(data).hexdigest()}), data)
        with patch.object(prepare.urllib.request, 'urlopen', return_value=io.BytesIO(data)):
            with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
                prepare.fetch({'url': 'https://example.invalid/uv', 'sha256': '0' * 64})

    def test_only_expected_binaries_are_extracted_from_both_archive_types(self):
        for suffix in ('.zip', '.tgz'):
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as directory:
                data = io.BytesIO()
                if suffix == '.zip':
                    with zipfile.ZipFile(data, 'w') as archive:
                        archive.writestr('nested/uv.exe', b'uv')
                        archive.writestr('../escaped', b'bad')
                    wanted = 'uv.exe'
                else:
                    with tarfile.open(fileobj=data, mode='w:gz') as archive:
                        member = tarfile.TarInfo('nested/uv'); member.size = 2
                        archive.addfile(member, io.BytesIO(b'uv'))
                        member = tarfile.TarInfo('../escaped'); member.size = 3
                        archive.addfile(member, io.BytesIO(b'bad'))
                    wanted = 'uv'
                prepare.unpack(data.getvalue(), suffix, Path(directory), {wanted})
                self.assertEqual([p.name for p in Path(directory).iterdir()], [wanted])
                with self.assertRaisesRegex(ValueError, 'Missing archive members'):
                    prepare.unpack(data.getvalue(), suffix, Path(directory), {'missing'})


if __name__ == '__main__':
    unittest.main()
