"""把 HTML 打印成 PDF：调用电脑上已有的 Edge / Chrome（不联网，不另装东西）。找不到浏览器时返回 None。"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def find_browser() -> str | None:
    if os.environ.get("YUNBAN_BROWSER"):
        return os.environ["YUNBAN_BROWSER"]
    if sys.platform == "win32":
        roots = [os.environ.get(k) for k in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA")]
        tails = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"]
        cands = [os.path.join(r, t) for t in tails for r in roots if r]
    elif sys.platform == "darwin":
        cands = [f"/Applications/{n}.app/Contents/MacOS/{n}" for n in ("Google Chrome", "Microsoft Edge", "Chromium")]
    else:
        cands = [shutil.which(n) for n in ("google-chrome", "chromium", "chromium-browser", "microsoft-edge")]
    return next((c for c in cands if c and os.path.isfile(c)), None)


def html_to_pdf(html: str, out: Path) -> bool:
    """成功返回 True；没有浏览器或打印失败返回 False。"""
    exe = find_browser()
    if not exe:
        return False
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        src = Path(tmp) / "doc.html"
        src.write_text(html, encoding="utf-8")
        cmd = [exe, "--headless", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", "--print-to-pdf-no-header",
               f"--user-data-dir={Path(tmp) / 'profile'}", f"--print-to-pdf={out}", src.as_uri()]
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except OSError:
            return False
        # 有的浏览器写完 PDF 后不会自己退出：文件大小稳定下来就算完成，然后把它关掉
        deadline, last, stable = time.time() + 90, -1, 0
        while time.time() < deadline and proc.poll() is None:
            time.sleep(0.25)
            size = out.stat().st_size if out.is_file() else 0
            stable = stable + 1 if size > 0 and size == last else 0
            last = size
            if stable >= 4:
                break
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    return out.is_file() and out.stat().st_size > 0
