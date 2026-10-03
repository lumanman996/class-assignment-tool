"""图形界面入口：开一个独立的程序窗口，里面显示界面（界面由本机的小服务提供，不联网）。

电脑上没有可用的窗口组件时，退而用系统默认浏览器打开同一个界面。
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
import webbrowser

from . import APP_NAME, APP_TITLE
from .server import start


def selftest() -> int:
    """打包后的自检：界面文件在不在、本地服务通不通、许可状态是什么、能不能出 PDF。不开窗口。"""
    httpd, url, app = start()
    html = urllib.request.urlopen(url, timeout=10).read().decode("utf-8")
    token = re.search(r'const TOKEN = "([^"]+)"', html).group(1)
    req = urllib.request.Request(url + "api/state", data=b"{}", headers={"X-Token": token, "Content-Type": "application/json"})
    st = json.loads(urllib.request.urlopen(req, timeout=10).read().decode("utf-8"))
    scripts_ok = all(urllib.request.urlopen(url + n, timeout=10).status == 200 for n in ("algo.js", "app.js", "demo.js", "xlsx.full.min.js"))
    httpd.shutdown()
    ok = APP_NAME in html and st.get("ok") and scripts_ok
    info = {"ok": bool(ok), "version": st["data"]["version"], "license": st["data"]["license"]["state"],
            "canPdf": st["data"]["canPdf"], "root": str(app.root)}
    (app.root / "自检结果.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(info, ensure_ascii=False))
    return 0 if ok else 1


def main(browser: bool = False):
    httpd, url, app = start()
    if not browser:
        try:
            import webview
            app.window = webview.create_window(APP_TITLE, url, width=1320, height=880, min_size=(1080, 720))
            webview.start()
            httpd.shutdown()
            return
        except Exception as e:                               # 没有窗口组件（或启动失败）：改用浏览器
            app.window = None
            print(f"窗口组件不可用（{type(e).__name__}），改用浏览器打开。")
    webbrowser.open(url)
    print(f"界面已在浏览器里打开：{url}\n关掉浏览器里的那个页面，本程序稍后会自动退出。")
    app.last_ping = time.time() + 20                         # 给浏览器一点启动时间
    try:
        while time.time() - app.last_ping < 30:              # 页面每 5 秒报一次到；30 秒没动静就退出
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    httpd.shutdown()
