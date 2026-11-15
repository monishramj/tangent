# Third-party notices

Direct dependencies from `package.json`, `src-tauri/Cargo.toml`, and `sidecar/pyproject.toml`, checked 2026-11-16. Transitive dependencies are not listed. Versions float with the lockfiles.

No direct dependency uses a non-permissive (copyleft) licence. Two weight downloads are separate from the library licence; see the flags at the bottom.

## JavaScript (`package.json`)

| Name | Licence | URL |
| --- | --- | --- |
| @hugeicons/core-free-icons | MIT | https://hugeicons.com |
| @hugeicons/react | MIT | https://hugeicons.com |
| @tailwindcss/vite | MIT | https://tailwindcss.com |
| @tauri-apps/api | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| @tauri-apps/plugin-dialog | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| @tauri-apps/plugin-process | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| @tauri-apps/plugin-updater | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| katex | MIT | https://katex.org |
| motion | MIT | https://github.com/motiondivision/motion |
| pixi.js | MIT | https://pixijs.com |
| react | MIT | https://react.dev |
| react-dom | MIT | https://react.dev |
| tailwindcss | MIT | https://tailwindcss.com |
| zod | MIT | https://zod.dev |
| @tauri-apps/cli (dev) | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| @testing-library/react (dev) | MIT | https://github.com/testing-library/react-testing-library |
| @types/node (dev) | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react (dev) | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom (dev) | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @vitejs/plugin-react (dev) | MIT | https://github.com/vitejs/vite-plugin-react |
| jsdom (dev) | MIT | https://github.com/jsdom/jsdom |
| typescript (dev) | Apache-2.0 | https://www.typescriptlang.org |
| vite (dev) | MIT | https://vite.dev |
| vitest (dev) | MIT | https://vitest.dev |

`@types/*` licences are from the DefinitelyTyped notices (MIT). npm did not return a separate homepage licence field for those three packages in this check.

## Rust (`src-tauri/Cargo.toml`)

Crate licences are from crates.io for the current 1.x/2.x/0.18/0.10 line, not an audit of `Cargo.lock`.

| Name | Licence | URL |
| --- | --- | --- |
| tauri | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tauri-build | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tauri-plugin-dialog | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-process | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-updater | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| serde | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_json | MIT OR Apache-2.0 | https://github.com/serde-rs/json |
| png | MIT OR Apache-2.0 | https://github.com/image-rs/image-png |
| sha2 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes |
| libc (unix) | MIT OR Apache-2.0 | https://github.com/rust-lang/libc |

## Python (`sidecar/pyproject.toml`)

| Name | Licence | URL |
| --- | --- | --- |
| docling | MIT | https://github.com/docling-project/docling |
| pocket-tts | MIT | https://github.com/kyutai-labs/pocket-tts |
| numpy | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | https://numpy.org |
| soundfile | BSD-3-Clause | https://github.com/bastibe/python-soundfile |
| torch | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND ISC AND MIT AND Zlib | https://pytorch.org |
| torchaudio | BSD (PyPI classifier; SPDX expression not published) | https://github.com/pytorch/audio |
| pytest (dev) | MIT | https://docs.pytest.org |

## Flags

- **pocket-tts weights.** The Python package is MIT. The Hugging Face model `kyutai/pocket-tts` reports **CC-BY-4.0** (attribution required, not copyleft): https://huggingface.co/kyutai/pocket-tts. Confirm before bundling or redistributing weights.
- **docling weights. Unknown.** The `docling` package is MIT. Model files it downloads are not declared in `pyproject.toml` and were not licence-checked here.
- **torchaudio SPDX. Unknown expression.** PyPI only publishes a BSD classifier.
- **PDFium** is loaded at runtime and is not in these three manifests. `docs/areas/packaging.md` records the prebuilt as BSD-3/Apache-2.0 from pdfium-binaries. Not re-verified in this pass.
