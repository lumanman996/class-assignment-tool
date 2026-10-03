"""程序的数据文件夹在哪里（导出的 Excel、PDF、方案文件都放在它下面的 output 里）。

- 用源码运行（python -m yunban）：项目文件夹。
- 用打包好的程序运行：
    Windows：程序文件所在的文件夹（解压到哪儿，结果就在哪儿）；
    Mac：“文稿/匀班”文件夹（Mac 的程序包里不能写东西）。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))


def app_root() -> Path:
    if os.environ.get("YUNBAN_HOME"):                      # 指定数据文件夹（自动测试用）
        return Path(os.environ["YUNBAN_HOME"]).resolve()
    if FROZEN and sys.platform == "darwin":
        return Path.home() / "Documents" / "匀班"
    if FROZEN:
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def ui_dir() -> Path:
    """界面文件所在的文件夹（打包后在程序包内部）。"""
    if FROZEN:
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "yunban" / "ui"
    return Path(__file__).resolve().parent / "ui"


ROOT = app_root()
OUTPUT = ROOT / "output"


def ensure_layout():
    OUTPUT.mkdir(parents=True, exist_ok=True)
