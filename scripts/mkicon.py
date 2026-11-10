# Builds the macOS-style app icon (rounded square, padding, shadow) from the flat logo.
# uv run --with pillow python scripts/mkicon.py assets/tangent-icon.png assets/app-icon.png && bunx tauri icon assets/app-icon.png
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageChops
src, out = sys.argv[1], sys.argv[2]
S = 1024; body = 824; off = (S - body) // 2; r = 186  # Apple macOS icon grid
logo = Image.open(src).convert("L")
mask = ImageOps.invert(logo)                     # logo pixels -> white
mask = mask.crop(mask.getbbox())
k = 480 / max(mask.size); mask = mask.resize((round(mask.width * k), round(mask.height * k)), Image.LANCZOS)
canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# soft drop shadow
sh = Image.new("L", (S, S), 0); ImageDraw.Draw(sh).rounded_rectangle((off, off + 12, off + body, off + body + 12), r, fill=110)
canvas.paste((0, 0, 0, 255), (0, 0), sh.filter(ImageFilter.GaussianBlur(18)))
# body: near-black with a faint top-to-bottom sheen
grad = Image.new("RGBA", (S, S))
for y in range(S):
    v = round(30 - 18 * (y - off) / body) if off <= y <= off + body else 0
    grad.paste((v, v, v, 255), (0, y, S, y + 1))
bm = Image.new("L", (S, S), 0); ImageDraw.Draw(bm).rounded_rectangle((off, off, off + body, off + body), r, fill=255)
canvas.paste(grad, (0, 0), bm)
# hairline inner border
ImageDraw.Draw(canvas).rounded_rectangle((off + 1, off + 1, off + body - 1, off + body - 1), r, outline=(255, 255, 255, 28), width=3)
# white logo, optically centred
x, y = (S - mask.width) // 2, (S - mask.height) // 2
canvas.paste((255, 255, 255, 255), (x, y), mask)
canvas.save(out)
