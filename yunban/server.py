"""只在本机（127.0.0.1）监听的小服务：提供界面文件，并替界面做它自己做不了的事
（保存文件、生成 PDF、试用与激活）。每次启动换一个随机口令，别的程序和网页调不了。"""
from __future__ import annotations

import base64
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import VERSION, license, paths, pdf

STATIC = {"algo.js": "text/javascript", "app.js": "text/javascript", "demo.js": "text/javascript",
          "xlsx.full.min.js": "text/javascript"}


class ApiError(Exception):
    """要原样显示给用户的错误说明。"""


class App:
    def __init__(self):
        self.root = paths.ROOT
        self.token = secrets.token_urlsafe(24)
        self.window = None
        self.last_ping = time.time()

    # 文件名里去掉系统不允许的字符；只允许写进 output 文件夹
    def _target(self, name: str, ext: str) -> Path:
        stem = re.sub(r'[\\/:*?"<>|\r\n\t]', "", str(name)).strip(" .")[:80] or "匀班"
        paths.ensure_layout()
        return paths.OUTPUT / f"{stem}.{ext}"

    def _inside_output(self, p: str) -> Path:
        path = Path(p).resolve()
        if paths.OUTPUT.resolve() not in path.parents or not path.is_file():
            raise ApiError("找不到这个文件。")
        return path

    def _write(self, path: Path, data: bytes) -> dict:
        try:
            path.write_bytes(data)
        except PermissionError:
            raise ApiError(f"「{path.name}」正被别的程序打开，请先关掉它再导出。")
        return {"path": str(path), "name": path.name, "folder": str(path.parent)}

    def api_state(self, body):
        return {"version": VERSION, "license": license.status(), "root": str(self.root),
                "output": str(paths.OUTPUT), "canPdf": pdf.find_browser() is not None}

    def api_activate(self, body):
        return license.activate(str(body.get("code", "")))

    def api_save(self, body):
        """kind=export：导出结果（需要许可）；kind=plan：方案文件（不需要，免得用户丢失工作）。"""
        kind, ext = body.get("kind"), body.get("ext")
        if (kind, ext) not in {("export", "xlsx"), ("plan", "json")}:
            raise ApiError("不支持的文件类型。")
        if kind == "export":
            license.require_export()
        return self._write(self._target(body.get("name"), ext), base64.b64decode(body.get("data", "")))

    def api_pdf(self, body):
        """把界面排好版的 HTML 打印成 PDF；电脑上没有 Edge / Chrome 时改存成网页文件。"""
        license.require_export()
        html = str(body.get("html", ""))
        out = self._target(body.get("name"), "pdf")
        try:
            out.unlink(missing_ok=True)
        except PermissionError:
            raise ApiError(f"「{out.name}」正被别的程序打开，请先关掉它再导出。")
        if pdf.html_to_pdf(html, out):
            return {"path": str(out), "name": out.name, "folder": str(out.parent), "kind": "pdf"}
        res = self._write(self._target(body.get("name"), "html"), html.encode("utf-8"))
        res["kind"] = "html"
        return res

    def api_open(self, body):
        open_path(self._inside_output(body.get("path", "")))
        return {}

    def api_reveal(self, body):
        paths.ensure_layout()
        open_path(paths.OUTPUT)
        return {}

    def api_ping(self, body):
        self.last_ping = time.time()
        return {}


def open_path(path: Path):
    if os.environ.get("YUNBAN_NO_OPEN"):                   # 自动测试时不要真的弹出窗口
        return
    if sys.platform == "win32":
        os.startfile(str(path))                            # noqa: S606
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(path)])


def make_handler(app: App):
    ui = paths.ui_dir()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):                      # 不往控制台刷日志
            pass

        def _send(self, code, body: bytes, ctype: str):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):   # 对方没等收完就断开了，不用管
                pass

        def _local(self) -> bool:
            host = (self.headers.get("Host") or "").split(":")[0]
            return host in ("127.0.0.1", "localhost")

        def do_GET(self):
            if not self._local():
                return self._send(403, b"", "text/plain")
            name = self.path.split("?")[0].lstrip("/")
            if name in ("", "index.html"):
                html = (ui / "index.html").read_text(encoding="utf-8").replace("__YUNBAN_TOKEN__", app.token)
                return self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")
            if name in STATIC:
                return self._send(200, (ui / name).read_bytes(), STATIC[name] + "; charset=utf-8")
            self._send(404, b"", "text/plain")

        def do_POST(self):
            name = self.path.lstrip("/")
            fn = getattr(app, "api_" + name[4:], None) if name.startswith("api/") else None
            if not self._local() or not secrets.compare_digest(self.headers.get("X-Token") or "", app.token) or fn is None:
                return self._send(403, b"", "text/plain")
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                res = {"ok": True, "data": fn(body)}
            except (ApiError, license.LicenseError) as e:
                res = {"ok": False, "error": str(e), "license": isinstance(e, license.LicenseError)}
            except Exception as e:                         # 意料之外的错误也要让界面有话可说
                res = {"ok": False, "error": f"出错了：{type(e).__name__}: {e}"}
            self._send(200, json.dumps(res, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    return Handler


def start():
    """启动服务，返回 (httpd, 界面地址, app)。"""
    paths.ensure_layout()
    app = App()
    port = int(os.environ.get("YUNBAN_PORT") or 0)           # 默认由系统挑一个空闲端口；开发调试时可固定
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/", app
