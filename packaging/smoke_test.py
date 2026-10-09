"""用打好的程序做自检：能启动、界面文件齐全、本地服务通、许可状态符合预期；
正式版还要检查验证模块是编译成机器码的、安装包里没有它的源码，并在程序副本里删掉它，确认导出被锁住；
再用刚打好的安装包走一遍“更新 → 替换程序文件 → 自动重新打开”。在打包之后运行。

用法:  python packaging/smoke_test.py
"""
import json
import os
import shutil
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
if info.get("license") == "expired":     # 在本机试跑时，这台电脑的试用可能已经到期（GitHub 上每次都是新电脑）
    print("（提醒）这台电脑的试用已到期：跳过生成 PDF 的试跑，照常检查一键更新。在 GitHub 上打包时每次都是完整试跑。")
print("自检通过")


def bundled_modules(app_dir: Path) -> set:
    """安装包里打进去的 Python 模块名（PyInstaller 把它们压在程序文件的 PYZ 里）。"""
    from PyInstaller.archive.readers import CArchiveReader
    names = set()
    for f in app_dir.rglob("*"):
        if not f.is_file() or f.suffix not in ("", ".exe") or f.stat().st_size < 100_000:
            continue
        try:
            arch = CArchiveReader(str(f))
        except Exception:
            continue
        for entry in arch.toc:
            if entry.endswith(".pyz") or entry == "PYZ.pyz" or entry.startswith("PYZ"):
                names.update(arch.open_embedded_archive(entry).toc)
    return names


def tamper_check():
    """在程序的一份副本里删掉验证模块：正式版应当锁住导出，而不是变成不限制的版本。"""
    tmp = Path(tempfile.mkdtemp(prefix="yunban-tamper-"))
    if mac:
        copy = tmp / f"{APP_NAME}.app"
        subprocess.run(["ditto", str(folder / f"{APP_NAME}.app"), str(copy)], check=True)
        copy_exe = copy / "Contents" / "MacOS" / APP_NAME
    else:
        copy = tmp / folder.name
        shutil.copytree(folder, copy)
        copy_exe = copy / exe.name
    found = [p for p in copy.rglob("_license_impl*") if p.suffix in (".so", ".pyd")]
    if not found:
        sys.exit("安装包里没有找到编译后的验证模块。")
    if [p for p in copy.rglob("_license_impl*") if p.suffix in (".py", ".pyc", ".c")]:
        sys.exit("安装包里不应该有验证模块的源码。")
    mods = bundled_modules(copy)
    if not mods:
        sys.exit("读不出安装包里打进去的模块列表，没法确认有没有验证模块的源码。")
    if "yunban._license_impl" in mods:
        sys.exit("安装包的程序文件里打进了验证模块的源码（应当只有编译后的机器码文件）。")
    for f in found:
        f.unlink()
    home2 = tmp / "数据"
    home2.mkdir()
    subprocess.run([str(copy_exe), "--selftest"], env=dict(env, YUNBAN_HOME=str(home2)), timeout=180, check=False)
    res = home2 / "自检结果.json"
    if not res.exists():
        sys.exit("删掉验证模块后，自检没有产生结果。")
    after = json.loads(res.read_text(encoding="utf-8"))
    print("删掉验证模块后:", json.dumps(after, ensure_ascii=False))
    if after.get("licenseModule") != "none" or after.get("canExport") or after.get("license") != "expired":
        sys.exit("防篡改检查未通过：删掉验证模块后导出没有锁住。")
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"防篡改检查通过：验证模块是机器码（{found[0].name}），安装包里没有源码；删掉它，导出就锁住。")


if licensed:                             # 正式版：验证模块必须是编译成机器码的
    if info.get("licenseModule") != "native":
        sys.exit(f"自检未通过：验证模块不是机器码（{info.get('licenseModule')}）。")
    tamper_check()

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
code = subprocess.run([str(exe), "--apply-update", str(zip_path), "--then-selftest"], env=env, timeout=180, check=False).returncode
print("更新命令退出码:", code)
deadline = time.time() + 240
while time.time() < deadline and not result.exists():
    time.sleep(1)
update_log = home / "更新日志.txt"
print("更新日志:\n" + (update_log.read_text(encoding="utf-8", errors="replace") if update_log.exists() else "（没有日志）"))
if not result.exists():
    sys.exit("更新自检未通过：换上新版本后程序没有重新启动。")
time.sleep(1)
info = json.loads(result.read_text(encoding="utf-8"))
replaced = (not marker.exists()) if mac else (marker.read_text(encoding="utf-8") != "old")
print("更新后自检结果:", json.dumps(info, ensure_ascii=False), "| 程序文件已替换:", replaced)
if not info.get("ok") or not replaced or not exe.exists():
    sys.exit("更新自检未通过。")
print("更新流程自检通过")
