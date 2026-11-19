"""Draw the Zhimo icon. Requires Pillow; not needed for normal builds."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'assets'
S = 4
im = Image.new('RGBA', (256*S, 256*S))
d = ImageDraw.Draw(im)


def poly(points, color):
    d.polygon([(x*S, y*S) for x, y in points], fill=color)


def rect(box, radius, color):
    d.rounded_rectangle(tuple(v*S for v in box), radius=radius*S, fill=color)


ink = '#34271F'
paper = '#F7EBD6'
# Folded sheet with a strong outline, no background plate.
poly([(47, 15), (151, 15), (218, 81), (218, 219), (202, 240), (46, 240), (30, 224), (30, 33)], ink)
poly([(47, 27), (148, 27), (206, 86), (206, 215), (196, 228), (50, 228), (42, 220), (42, 37)], paper)
poly([(145, 24), (210, 87), (155, 87), (145, 77)], '#DFC6A5')
# Bold Markdown M, sized to read in the taskbar at 16 pixels.
poly([(62, 177), (62, 106), (77, 106), (102, 137), (127, 106), (142, 106), (142, 177), (127, 177), (127, 132), (103, 160), (101, 160), (77, 132), (77, 177)], ink)
# Down arrow doubles as a cinnabar seal.
rect((149, 147, 192, 195), 7, '#A83D2C')
poly([(166, 155), (175, 155), (175, 173), (184, 173), (170.5, 187), (157, 173), (166, 173)], '#FFF3E0')
OUT.mkdir(exist_ok=True)
im.resize((512, 512), Image.Resampling.LANCZOS).save(OUT/'app-icon.png', optimize=True)
sizes = (16, 24, 32, 48, 64, 128, 256)
frames = []
for n in sizes:
    frame = im.resize((n, n), Image.Resampling.LANCZOS)
    frame.putalpha(frame.getchannel('A').point(lambda v: 0 if v < 3 else v))
    frames.append(frame)
frames[-1].save(OUT/'app-icon.ico', sizes=[f.size for f in frames], append_images=frames[:-1])
