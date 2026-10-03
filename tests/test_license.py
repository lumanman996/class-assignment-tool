"""试用与激活的测试。验证模块和私钥不在公开仓库里，没有它们时整个文件跳过。"""
import importlib.util
import json
import os
import time
from pathlib import Path

import pytest

impl = pytest.importorskip("yunban._license_impl")
ADMIN = Path(__file__).resolve().parent.parent / "admin"
if not (ADMIN / "private_key.pem").exists():
    pytest.skip("没有私钥，跳过", allow_module_level=True)

spec = importlib.util.spec_from_file_location("make_code", ADMIN / "make_code.py")
make_code = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_code)

from yunban import license, server  # noqa: E402


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("YUNBAN_LICENSE_DIR", str(tmp_path))
    yield tmp_path


def age(days):
    """把试用开始时间拨到 days 天前（按程序自己的方式写，校验是对的）。"""
    st = impl._load()
    st["first"] = time.time() - days * 86400
    impl._save(st)


def test_machine_code_stable_and_per_machine(monkeypatch):
    a = impl.machine_code()
    assert a == impl.machine_code() and len(a) == 14
    monkeypatch.setattr(impl, "_HW", "another-machine")
    assert impl.machine_code() != a


def test_trial_then_expired():
    st = license.status()
    assert st["state"] == "trial" and st["daysLeft"] == 3 and st["canExport"]
    age(2.5)
    assert license.status()["daysLeft"] == 1
    age(3.1)
    st = license.status()
    assert st["state"] == "expired" and not st["canExport"]
    with pytest.raises(license.LicenseError):
        license.require_export()


def test_deleting_one_record_does_not_reset_trial(fresh):
    license.status()
    age(5)
    (fresh / "a.json").unlink()
    assert license.status()["state"] == "expired"


def test_tampered_record_counts_as_expired(fresh):
    license.status()
    for name in ("a.json", "b.json"):
        data = json.loads((fresh / name).read_text())
        data["first"] = time.time() + 86400 * 365          # 手工把开始时间改到未来
        (fresh / name).write_text(json.dumps(data))
    assert license.status()["state"] == "expired"


def test_clock_rollback_does_not_extend(monkeypatch):
    license.status()
    age(5)
    license.status()
    real = time.time
    monkeypatch.setattr(time, "time", lambda: real() - 30 * 86400)
    assert license.status()["state"] == "expired"


def test_activation():
    age(10)
    me = impl.machine_code()
    assert not license.activate("abc.def")["activated"]
    assert "不是发给这台电脑" in license.activate(make_code.make("AAAA-BBBB-CCCC"))["message"]
    assert "到期" in license.activate(make_code.make(me, "2020-01-01"))["message"]
    good = make_code.make(me, "2099-12-31")
    head, sig = good.split(".")
    assert not license.activate(head[:-2] + "AA." + sig)["activated"]      # 改过内容的码
    assert license.status()["state"] == "expired"
    res = license.activate(good)
    assert res["activated"] and res["state"] == "active" and res["expiry"] == "2099-12-31"
    st = license.status()                                                   # 重新读取仍是已激活
    assert st["state"] == "active" and st["canExport"]
    license.require_export()


def test_permanent_code():
    age(10)
    res = license.activate(make_code.make(impl.machine_code()))
    assert res["state"] == "active" and res["expiry"] is None


def test_server_refuses_export_when_expired():
    """界面被改掉也没用：保存和生成 PDF 由外壳程序把关。"""
    age(10)
    app = server.App()
    with pytest.raises(license.LicenseError):
        app.api_save({"kind": "export", "ext": "xlsx", "name": "x", "data": ""})
    with pytest.raises(license.LicenseError):
        app.api_pdf({"name": "x", "html": "<p>x</p>"})
    assert app.api_save({"kind": "plan", "ext": "json", "name": "方案", "data": ""})["name"] == "方案.json"
