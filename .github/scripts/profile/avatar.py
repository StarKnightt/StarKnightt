# Turns the GitHub avatar into the ASCII portrait shown on the terminal's right side.
# Run by hand when the avatar changes (needs Pillow):
#   python .github/scripts/profile/avatar.py <avatar.jpg> > .github/scripts/profile/avatar.txt
import sys
from PIL import Image, ImageOps, ImageFilter

COLS, ROWS = 46, 26           # terminal cells; a mono cell is ~2x taller than wide
RAMP = " .,:;-~=+*o#%@"       # light -> dense; dark lines in the drawing become dense glyphs

im = Image.open(sys.argv[1]).convert("L")
im = ImageOps.autocontrast(im, cutoff=2).filter(ImageFilter.SHARPEN)
im = im.resize((COLS, ROWS), Image.LANCZOS)

cx, cy, r = (COLS - 1) / 2, (ROWS - 1) / 2, COLS / 2 - 0.5
out = []
for y in range(ROWS):
    row = ""
    for x in range(COLS):
        # Keep only the round avatar; the corners stay blank.
        if ((x - cx) / r) ** 2 + ((y - cy) / (r * ROWS / COLS)) ** 2 > 1:
            row += " "
            continue
        ink = 1 - im.getpixel((x, y)) / 255
        ink = max(0.0, (ink - 0.18) / 0.82)   # paper white stays blank
        row += RAMP[min(len(RAMP) - 1, int(ink ** 0.8 * len(RAMP)))]
    out.append(row.rstrip())
print("\n".join(out))
