"""用打好的程序做自检：能启动、界面文件齐全、本地服务通、许可状态符合预期；
再用刚打好的安装包走一遍“更新 → 替换程序文件 → 自动重新打开”。在打包之后运行。

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

# ---- 更新流程：拿刚打好的安装包当“新版本”，让程序把自己换掉再重新打开 ----
import time  # noqa: E402

zip_path = root / "dist" / f"yunban-{'Mac' if mac else 'Windows'}.zip"
if mac:
    marker = folder / f"{APP_NAME}.app" / "Contents" / "Resources" / "旧版本标记.txt"   # 整个 .app 被换掉后它应当消失
    marker.write_text("old", encoding="utf-8")
else:
    marker = folder / "使用说明.txt"                                                    # 文件被新版覆盖后内容应当恢复
    marker.write_text("old", encoding="utf-8")
result.unlink()
subprocess.run([str(exe), "--apply-update", str(zip_path), "--then-selftest"], env=env, timeout=180, check=False)
deadline = time.time() + 240
while time.time() < deadline and not result.exists():
    time.sleep(1)
if not result.exists():
    sys.exit("更新自检未通过：换上新版本后程序没有重新启动。")
time.sleep(1)
info = json.loads(result.read_text(encoding="utf-8"))
replaced = (not marker.exists()) if mac else (marker.read_text(encoding="utf-8") != "old")
print("更新后自检结果:", json.dumps(info, ensure_ascii=False), "| 程序文件已替换:", replaced)
if not info.get("ok") or not replaced or not exe.exists():
    sys.exit("更新自检未通过。")
print("更新流程自检通过")
