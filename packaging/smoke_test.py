"""用打好的程序做自检：能启动、界面文件齐全、本地服务通、许可状态符合预期。在打包之后运行。

用法:  python packaging/smoke_test.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
from yunban import APP_NAME  # noqa: E402

mac = sys.platform == "darwin"
folder = root / "dist" / f"{APP_NAME}-{'Mac' if mac else 'Windows'}"
exe = folder / f"{APP_NAME}.app" / "Contents" / "MacOS" / APP_NAME if mac else folder / f"{APP_NAME}.exe"
if not exe.exists():
    sys.exit(f"没有找到打包好的程序：{exe}")

home = Path(tempfile.mkdtemp(prefix="yunban-smoke-"))
env = dict(os.environ, YUNBAN_HOME=str(home), YUNBAN_NO_OPEN="1")
subprocess.run([str(exe), "--selftest"], env=env, timeout=180, check=False)
result = home / "自检结果.json"
if not result.exists():
    sys.exit("自检没有产生结果，程序可能没有正常启动。")
info = json.loads(result.read_text(encoding="utf-8"))
print("自检结果:", json.dumps(info, ensure_ascii=False))
licensed = (root / "yunban" / "_license_impl.py").exists()
expect = ("trial", "active", "expired") if licensed else ("open",)
if not info.get("ok") or info.get("license") not in expect:
    sys.exit(f"自检未通过（许可状态应为 {' / '.join(expect)}）。")
if licensed and not info.get("hasMachineCode"):
    sys.exit("自检未通过：没有取到机器码。")
if info.get("canPdf") and info.get("license") != "expired" and not info.get("pdfMade"):
    sys.exit("自检未通过：电脑上有浏览器，但没有生成 PDF。")
print("自检通过")
