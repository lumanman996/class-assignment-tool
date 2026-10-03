"""总入口：无参数开界面；--browser 用浏览器显示界面；--serve 只启动服务（开发调试用）；--selftest 做打包后的自检；
--apply-update <安装包.zip | online> [--then-selftest] 不开界面直接更新（打包自检用，online 表示从发布页下载最新版）。"""
from __future__ import annotations

import sys


def _apply_update(source: str, relaunch_args: list) -> int:
    import time
    from pathlib import Path
    from . import updater
    up = updater.Updater()
    if source == "online":
        info = updater.check(timeout=20)
        if not info.get("newer") or not info.get("canAuto"):
            print("没有可以自动安装的新版本：", info.get("reason") or "已是最新", flush=True)
            return 2
        up.start(info["asset"])
        while up.status()["phase"] == "downloading":
            time.sleep(0.5)
    try:
        if source != "online":
            up.prepare(Path(source).resolve())
        if up.status()["phase"] != "ready":
            raise ValueError(up.status()["error"] or "新版本没有准备好")
        up.apply(relaunch_args)
    except Exception as e:                                   # 带窗口的程序没有控制台，原因记到更新日志里
        updater.log(f"更新没有完成：{type(e).__name__}: {e}")
        print("更新没有完成：", e, flush=True)
        return 1
    return 0


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
    if "--apply-update" in argv:
        return _apply_update(argv[argv.index("--apply-update") + 1], ["--selftest"] if "--then-selftest" in argv else [])
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
