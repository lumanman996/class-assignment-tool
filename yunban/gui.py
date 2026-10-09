"""图形界面入口：开一个独立的程序窗口，里面显示界面（界面由本机的小服务提供，不联网）。

电脑上没有可用的窗口组件时，退而用系统默认浏览器打开同一个界面。
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
import webbrowser

from . import APP_NAME, APP_TITLE, license
from .server import start


def selftest() -> int:
    """打包后的自检：界面文件在不在、本地服务通不通、许可状态是什么，并真的保存一个文件、生成一份 PDF。不开窗口。"""
    httpd, url, app = start()
    html = urllib.request.urlopen(url, timeout=10).read().decode("utf-8")
    token = re.search(r'const TOKEN = "([^"]+)"', html).group(1)

    def call(name, body=None):
        req = urllib.request.Request(url + "api/" + name, data=json.dumps(body or {}).encode("utf-8"),
                                     headers={"X-Token": token, "Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=150).read().decode("utf-8"))

    st = call("state")
    saved = call("save", {"kind": "plan", "ext": "json", "name": "自检-方案", "data": "e30="})
    made = {"ok": False}
    if st["data"]["license"]["canExport"]:
        made = call("pdf", {"name": "自检-报告", "html": "<html><meta charset='utf-8'><body><h1>匀班 自检</h1><p>中文 PDF</p></body></html>"})
    scripts_ok = all(len(urllib.request.urlopen(url + n, timeout=10).read()) > 0 for n in ("algo.js", "app.js", "demo.js", "xlsx.full.min.js"))
    httpd.shutdown()
    ok = APP_NAME in html and st.get("ok") and scripts_ok and saved.get("ok")
    lic = st["data"]["license"]
    info = {"ok": bool(ok), "version": st["data"]["version"], "license": lic["state"], "hasMachineCode": bool(lic.get("machine")),
            "canPdf": st["data"]["canPdf"], "pdfMade": bool(made.get("ok") and made["data"]["kind"] == "pdf"), "root": str(app.root),
            "licenseModule": license.module_kind(), "canExport": lic["canExport"]}
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
