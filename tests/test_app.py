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
