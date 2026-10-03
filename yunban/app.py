"""总入口：无参数开界面；--browser 用浏览器显示界面；--serve 只启动服务（开发调试用）；--selftest 做打包后的自检。"""
from __future__ import annotations

import sys


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    for stream in (sys.stdout, sys.stderr):                  # 英文 Windows 的控制台也要能输出中文
        if stream is not None and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (OSError, ValueError):
                pass
    from . import gui
    if "--selftest" in argv or "--自检" in argv:
        return gui.selftest()
    if "--serve" in argv:
        import time
        from .server import start
        httpd, url, _ = start()
        print(f"服务已启动：{url}（Ctrl+C 结束）", flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            httpd.shutdown()
        return 0
    gui.main(browser="--browser" in argv)
    return 0
