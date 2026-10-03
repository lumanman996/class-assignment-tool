"""外壳程序的测试：本机服务、保存文件、生成 PDF。"""
import base64
import json
import urllib.error
import urllib.request

import pytest

from yunban import license, paths, pdf, server


@pytest.fixture(scope="module")
def srv():
    httpd, url, app = server.start()
    yield url, app
    httpd.shutdown()


def call(url, token, name, body=None):
    req = urllib.request.Request(url + "api/" + name, data=json.dumps(body or {}).encode(),
                                 headers={"X-Token": token, "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read().decode())


def test_page_and_scripts(srv):
    url, app = srv
    html = urllib.request.urlopen(url).read().decode()
    assert "匀班" in html and app.token in html and "__YUNBAN_TOKEN__" not in html
    for name in ("algo.js", "app.js", "demo.js", "xlsx.full.min.js"):
        assert urllib.request.urlopen(url + name).status == 200
    with pytest.raises(urllib.error.HTTPError):                 # 界面之外的文件不提供
        urllib.request.urlopen(url + "../README.md")


def test_homepage_is_fixed(srv):
    url, app = srv
    res = call(url, app.token, "homepage", {"url": "https://example.com/别的地址"})
    assert res["ok"] and res["data"]["url"] == "https://github.com/lumanman996/class-assignment-tool"


def test_token_required(srv):
    url, app = srv
    with pytest.raises(urllib.error.HTTPError) as e:
        call(url, "wrong-token", "state")
    assert e.value.code == 403


def test_state(srv):
    url, app = srv
    st = call(url, app.token, "state")
    assert st["ok"] and st["data"]["license"]["state"] in ("open", "trial", "active", "expired")


def test_save_only_into_output(srv):
    url, app = srv
    res = call(url, app.token, "save", {"kind": "plan", "ext": "json", "name": "../../逃出去", "data": base64.b64encode(b"{}").decode()})
    assert res["ok"]
    saved = paths.Path(res["data"]["path"]) if hasattr(paths, "Path") else None
    from pathlib import Path
    saved = Path(res["data"]["path"])
    assert saved.parent == paths.OUTPUT and saved.read_bytes() == b"{}"
    bad = call(url, app.token, "save", {"kind": "export", "ext": "exe", "name": "x", "data": ""})
    assert not bad["ok"]
    assert not call(url, app.token, "open", {"path": "/etc/hosts"})["ok"]


@pytest.mark.skipif(pdf.find_browser() is None, reason="这台电脑上没有 Edge / Chrome")
def test_pdf(srv):
    url, app = srv
    if not license.status()["canExport"]:
        pytest.skip("当前许可状态不能导出")
    res = call(url, app.token, "pdf", {"name": "测试报告", "html": "<html><body><h1>匀班</h1></body></html>"})
    assert res["ok"] and res["data"]["kind"] == "pdf"
    from pathlib import Path
    assert Path(res["data"]["path"]).read_bytes()[:4] == b"%PDF"


# ---- 版本检测与更新 ----

def test_version_compare():
    from yunban import updater
    assert updater.parse_version("v2.0.10") > updater.parse_version("2.0.9")
    assert updater.parse_version("2.1") == (2, 1, 0)


def test_update_check(monkeypatch):
    from yunban import updater
    monkeypatch.delenv("YUNBAN_NO_UPDATE_CHECK")
    monkeypatch.setattr(updater, "asset_name", lambda: "yunban-Mac.zip")
    asset = {"name": "yunban-Mac.zip", "browser_download_url": updater.DOWNLOAD_PREFIX + "v9.9.9/yunban-Mac.zip", "size": 1, "digest": "sha256:00"}
    release = {"tag_name": "v9.9.9", "body": "## 更新内容\n\n更新说明\n\n## 下载\n\n下载方法", "assets": [asset]}
    monkeypatch.setattr(updater, "_fetch_json", lambda url, timeout: release)
    info = updater.check()
    assert info["newer"] and info["latest"] == "9.9.9" and info["notes"] == "更新说明"
    assert not info["canAuto"] and info["reason"]              # 用源码运行时不自动替换，只给出原因

    release["tag_name"] = "v" + updater.VERSION               # 已是最新
    assert not updater.check()["newer"]

    def offline(url, timeout):
        raise OSError("no network")
    monkeypatch.setattr(updater, "_fetch_json", offline)       # 没网：不报错，只说明查不了
    info = updater.check()
    assert not info["ok"] and not info["newer"]


def test_update_download_only_from_project(monkeypatch):
    """下载地址不是本项目发布页的，一律不下载。"""
    import time
    from yunban import updater
    up = updater.Updater()
    up.start({"name": "x.zip", "browser_download_url": "https://example.com/x.zip", "size": 1})
    for _ in range(50):
        if up.status()["phase"] != "downloading":
            break
        time.sleep(0.1)
    assert up.status()["phase"] == "error"


def test_update_api_refuses_without_new_version(srv):
    url, app = srv
    assert call(url, app.token, "update_check")["data"]["newer"] is False
    assert not call(url, app.token, "update_start")["ok"]
    assert not call(url, app.token, "update_apply")["ok"]
