"""版本检测与联网更新。

只访问 GitHub 上本项目的发布页：查最新版本号、下载对应系统的安装包。不发送任何用户数据。
更新过程：下载 → 校验 → 解压到临时文件夹 → 退出程序 → 由一个小脚本替换程序文件 → 重新打开。
数据文件夹里的 output 和激活状态不受影响。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path

from . import APP_NAME, HOMEPAGE, VERSION

API = "https://api.github.com/repos/lumanman996/class-assignment-tool/releases/latest"
RELEASES_PAGE = HOMEPAGE + "/releases/latest"
DOWNLOAD_PREFIX = HOMEPAGE + "/releases/download/"       # 只从本项目的发布页下载
FROZEN = bool(getattr(sys, "frozen", False))


def current_version() -> str:
    if not FROZEN and os.environ.get("YUNBAN_VERSION_OVERRIDE"):   # 开发调试用；打包后的程序不认
        return os.environ["YUNBAN_VERSION_OVERRIDE"]
    return VERSION


def parse_version(text: str) -> tuple:
    nums = [int(n) for n in re.findall(r"\d+", str(text))[:3]]
    return tuple(nums + [0] * (3 - len(nums)))


def asset_name() -> str | None:
    return {"win32": "yunban-Windows.zip", "darwin": "yunban-Mac.zip"}.get(sys.platform)


def install_target():
    """返回 (可以自动替换的安装位置, 不能自动更新的原因)。两者必有一个为空。"""
    if not FROZEN:
        return None, "用源码运行的版本请到项目主页获取更新。"
    exe = Path(sys.executable).resolve()
    if sys.platform == "darwin":
        target = exe.parents[2]                              # 匀班.app
        if "AppTranslocation" in str(target):
            return None, "请先把「匀班」拖到别的文件夹（比如“应用程序”）再打开，之后就可以自动更新了。"
        writable = os.access(target.parent, os.W_OK) and os.access(target, os.W_OK)
    elif sys.platform == "win32":
        target = exe.parent
        writable = os.access(target, os.W_OK)
    else:
        return None, "这个系统暂不支持自动更新。"
    if not writable:
        return None, "程序所在的文件夹不允许修改，无法自动更新。"
    return target, ""


def _fetch_json(url: str, timeout: float) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": f"yunban/{VERSION}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _changes(body: str) -> str:
    """发布说明里只取“更新内容”一段给用户看，去掉后面固定的下载说明。"""
    text = body.split("## 下载")[0].replace("## 更新内容", "").strip()
    return re.sub(r"^- ", "· ", text, flags=re.M)


def check(timeout: float = 6) -> dict:
    """查最新版本。联不上网时 ok 为 False，由界面决定要不要提示。"""
    cur = current_version()
    base = {"ok": True, "current": cur, "latest": cur, "newer": False, "notes": "", "page": RELEASES_PAGE,
            "canAuto": False, "reason": ""}
    if os.environ.get("YUNBAN_NO_UPDATE_CHECK"):             # 自动测试时不联网
        return base
    try:
        rel = _fetch_json(API, timeout)
    except Exception:
        return {**base, "ok": False, "reason": "没有连上 GitHub，暂时无法检查更新。"}
    latest = str(rel.get("tag_name", "")).lstrip("vV")
    if not latest or parse_version(latest) <= parse_version(cur):
        return base
    asset = next((a for a in rel.get("assets", []) if a.get("name") == asset_name()), None)
    target, reason = install_target()
    if not reason and not asset:
        reason = "新版本还没有适用于这个系统的安装包。"
    return {**base, "latest": latest, "newer": True, "notes": _changes(str(rel.get("body") or "")),
            "canAuto": not reason, "reason": reason,
            "asset": {k: asset.get(k) for k in ("name", "browser_download_url", "size", "digest")} if asset else None}


class Updater:
    """下载和安装的状态。phase：idle / downloading / ready / error。"""

    def __init__(self):
        self.lock = threading.Lock()
        self.phase, self.percent, self.error = "idle", 0, ""
        self.tmp: Path | None = None
        self.new_root: Path | None = None

    def status(self) -> dict:
        with self.lock:
            return {"phase": self.phase, "percent": self.percent, "error": self.error}

    def _set(self, **kw):
        with self.lock:
            for k, v in kw.items():
                setattr(self, k, v)

    def start(self, asset: dict):
        with self.lock:
            if self.phase == "downloading":
                return
            self.phase, self.percent, self.error = "downloading", 0, ""
        threading.Thread(target=self._download, args=(asset,), daemon=True).start()

    def _download(self, asset: dict):
        try:
            url = str(asset.get("browser_download_url", ""))
            if not url.startswith(DOWNLOAD_PREFIX):
                raise ValueError("下载地址不对。")
            tmp = Path(tempfile.mkdtemp(prefix="yunban-update-"))
            zip_path = tmp / "update.zip"
            total, done, sha = int(asset.get("size") or 0), 0, hashlib.sha256()
            req = urllib.request.Request(url, headers={"User-Agent": f"yunban/{VERSION}"})
            with urllib.request.urlopen(req, timeout=30) as r, open(zip_path, "wb") as f:
                while chunk := r.read(1 << 16):
                    f.write(chunk)
                    sha.update(chunk)
                    done += len(chunk)
                    if total:
                        self._set(percent=min(99, int(done * 100 / total)))
            if total and done != total:
                raise ValueError("下载不完整，请重试。")
            digest = str(asset.get("digest") or "")
            if digest.startswith("sha256:") and digest[7:].lower() != sha.hexdigest():
                raise ValueError("下载的文件校验没有通过，请重试。")
            self.prepare(zip_path, tmp)
        except Exception as e:
            self._set(phase="error", error=str(e) if isinstance(e, ValueError) else f"下载失败（{type(e).__name__}）。可以稍后再试，或到下载页面手动下载。")

    def prepare(self, zip_path: Path, tmp: Path | None = None):
        """解压安装包并确认里面有程序。成功后 phase 变为 ready。"""
        tmp = tmp or Path(tempfile.mkdtemp(prefix="yunban-update-"))
        new = tmp / "new"
        if sys.platform == "darwin":                         # ditto 能还原 .app 里的符号链接和可执行权限
            subprocess.run(["ditto", "-x", "-k", str(zip_path), str(new)], check=True)
            root = new / f"{APP_NAME}-Mac" / f"{APP_NAME}.app"
            ok = (root / "Contents" / "MacOS" / APP_NAME).is_file()
        else:
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(new)
            root = new / f"{APP_NAME}-Windows"
            ok = (root / f"{APP_NAME}.exe").is_file()
        if not ok:
            raise ValueError("安装包里没有找到程序，请到下载页面手动下载。")
        self._set(tmp=tmp, new_root=root, phase="ready", percent=100)

    def apply(self, relaunch_args: list[str] | None = None):
        """启动替换脚本。调用后程序应当立刻退出，脚本会等它退出再动手。"""
        target, reason = install_target()
        if reason:
            raise ValueError(reason)
        if self.phase != "ready" or not self.new_root:
            raise ValueError("新版本还没有准备好。")
        pid, args = os.getpid(), list(relaunch_args or [])
        if sys.platform == "darwin":
            q = shlex.quote
            old = str(target) + ".old"
            exe = target / "Contents" / "MacOS" / APP_NAME
            launch = " ".join([q(str(exe))] + [q(a) for a in args]) + " &" if args else f"open {q(str(target))}"
            script = self.tmp / "update.sh"
            script.write_text(f"""#!/bin/sh
while kill -0 {pid} 2>/dev/null; do sleep 0.3; done
rm -rf {q(old)}
if mv {q(str(target))} {q(old)} && mv {q(str(self.new_root))} {q(str(target))}; then
  rm -rf {q(old)}
elif [ -d {q(old)} ] && [ ! -d {q(str(target))} ]; then
  mv {q(old)} {q(str(target))}
fi
{launch}
rm -rf {q(str(self.tmp))}
""", encoding="utf-8")
            subprocess.Popen(["/bin/sh", str(script)], start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            p = lambda s: "'" + str(s).replace("'", "''") + "'"   # noqa: E731  PowerShell 单引号字符串
            exe = target / f"{APP_NAME}.exe"
            arg_part = f" -ArgumentList {','.join(p(a) for a in args)}" if args else ""
            script = self.tmp / "update.ps1"
            script.write_text(f"""$ErrorActionPreference = 'SilentlyContinue'
while (Get-Process -Id {pid}) {{ Start-Sleep -Milliseconds 300 }}
for ($i = 0; $i -lt 20; $i++) {{
  try {{
    Copy-Item -Path (Join-Path {p(self.new_root)} '*') -Destination {p(target)} -Recurse -Force -ErrorAction Stop
    break
  }} catch {{ Start-Sleep -Milliseconds 500 }}
}}
Start-Process -FilePath {p(exe)}{arg_part}
Remove-Item -Path {p(self.tmp)} -Recurse -Force
""", encoding="utf-8-sig")
            flags = 0x00000008 | 0x00000200 | getattr(subprocess, "CREATE_NO_WINDOW", 0)   # 脱离本进程独立运行
            subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", str(script)],
                             creationflags=flags, close_fds=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def cleanup(self):
        if self.tmp:
            shutil.rmtree(self.tmp, ignore_errors=True)
