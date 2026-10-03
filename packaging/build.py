"""打包成免安装程序，并压缩成 zip。在哪个系统上运行，就打哪个系统的包。

用法:  python packaging/build.py
结果:  dist/匀班-Windows.zip（解压后双击 匀班.exe）或 dist/匀班-Mac.zip（解压后双击 匀班.app）
yunban/_license_impl.py 存在时打出来的是带试用与激活的正式安装包；不存在则是不限制的版本。
"""
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
from yunban import APP_NAME, VERSION  # noqa: E402

mac = sys.platform == "darwin"
sep = ";" if sys.platform == "win32" else ":"
licensed = (root / "yunban" / "_license_impl.py").exists()

for d in ("build", "dist"):
    shutil.rmtree(root / d, ignore_errors=True)

cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--name", APP_NAME,
       "--icon", str(root / "packaging" / ("icon.icns" if mac else "icon.ico")),
       "--add-data", f"{root / 'yunban' / 'ui'}{sep}yunban/ui",
       "--distpath", str(root / "dist"), "--workpath", str(root / "build"), "--specpath", str(root / "build")]
if licensed:
    cmd += ["--hidden-import", "yunban._license_impl"]
if mac:
    cmd += ["--osx-bundle-identifier", "cn.yunban.app"]
cmd.append(str(root / "packaging" / "entry.py"))
subprocess.run(cmd, check=True, cwd=root)

dist = root / "dist"
folder = dist / f"{APP_NAME}-{'Mac' if mac else 'Windows'}"
folder.mkdir()
if mac:
    shutil.rmtree(dist / APP_NAME, ignore_errors=True)       # Mac 上只要 .app
    shutil.move(str(dist / f"{APP_NAME}.app"), folder / f"{APP_NAME}.app")
else:
    for item in (dist / APP_NAME).iterdir():
        shutil.move(str(item), folder / item.name)
    shutil.rmtree(dist / APP_NAME)
shutil.copy2(root / "packaging" / "使用说明.txt", folder / "使用说明.txt")
shutil.copy2(root / "演示名单.xlsx", folder / "演示名单.xlsx")

zip_path = dist / folder.name
if mac:                                                      # ditto 能保留 .app 里的符号链接和可执行权限
    subprocess.run(["ditto", "-c", "-k", "--keepParent", str(folder), str(zip_path) + ".zip"], check=True)
else:
    shutil.make_archive(str(zip_path), "zip", dist, folder.name)
print(f"已生成 {zip_path}.zip（版本 {VERSION}，{'带试用与激活' if licensed else '不限制的版本'}）")
