cd "$(dirname "$0")"
for f in ch-2_cs250_txtbook ch-1_cs250_txtbook cs-3_cs250_txtbook ch-4_cs250_txtbook; do uv run python run.py ../inputs/cs250/$f.pdf out/$f --mode fast --disable_ocr; done
uv run python run.py ../inputs/stat350_ch1.pdf out/stat350_ch1 --mode fast --disable_ocr
