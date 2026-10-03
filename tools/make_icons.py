"""生成程序图标：packaging/icon.png、icon.ico（Windows）、icon.icns（Mac，需在 Mac 上运行）。
用法:  .venv/bin/python tools/make_icons.py     需要 Pillow 和一款宋体（Mac 自带 Songti）。
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

out = Path(__file__).resolve().parent.parent / "packaging"
FONTS = ["/System/Library/Fonts/Supplemental/Songti.ttc", "C:/Windows/Fonts/simsun.ttc", "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"]
font_path = next((f for f in FONTS if Path(f).exists()), None)
if not font_path:
    sys.exit("没有找到宋体字体。")

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
pad = 64                                                     # 四周留白，符合系统图标的视觉大小
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=200, fill="#993C1D")
font = ImageFont.truetype(font_path, 560, index=1 if font_path.endswith("Songti.ttc") else 0)   # Songti.ttc 的第 1 个是粗体
box = d.textbbox((0, 0), "匀", font=font)
d.text(((S - (box[2] - box[0])) / 2 - box[0], (S - (box[3] - box[1])) / 2 - box[1]), "匀", font=font, fill="#ffffff")

img.save(out / "icon.png")
img.save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
if sys.platform == "darwin" and shutil.which("iconutil"):
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            img.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
            img.resize((size * 2, size * 2), Image.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(out / "icon.icns")], check=True)
print("已生成", ", ".join(p.name for p in sorted(out.glob("icon.*"))))
