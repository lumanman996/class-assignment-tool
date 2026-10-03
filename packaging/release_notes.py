"""生成某个版本的发布说明：CHANGELOG.md 里这个版本的更新内容 + 固定的下载说明。

用法:  python packaging/release_notes.py v2.0.4 发布说明输出.md
程序里的「发现新版本」窗口显示的就是“更新内容”这一段。
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
version = sys.argv[1].lstrip("vV")
changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
m = re.search(rf"^## v{re.escape(version)}\s*\n(.*?)(?=^## v|\Z)", changelog, flags=re.M | re.S)
changes = m.group(1).strip() if m else "见仓库里的 CHANGELOG.md。"
notes = f"## 更新内容\n\n{changes}\n\n" + (root / "packaging" / "发布说明.md").read_text(encoding="utf-8")
Path(sys.argv[2]).write_text(notes, encoding="utf-8")
print(f"已生成 {sys.argv[2]}（v{version}）")
