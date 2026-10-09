"""使用许可（试用与激活）的入口。

公开源码里只有这个入口。真正的试用、激活验证在 `_license_impl.py` 里，那个文件不在公开仓库中，
只在打包正式安装包时编译成机器码放进去（packaging/compile_license.py）。
没有它的时候（比如用公开源码自己运行），程序不做任何限制；
但正式安装包（打包时记下了 _build_info.LICENSED）里如果它不见了或坏了，就锁住导出，不能因为删掉一个文件就不限制了。
"""
from __future__ import annotations

from .paths import FROZEN

try:
    from . import _license_impl as _impl
except Exception:            # 公开源码版：没有许可模块，不限制（正式安装包里缺了它，见下面的 LICENSED）
    _impl = None

try:
    from ._build_info import LICENSED     # 打包时自动生成：这是带试用与激活的正式版本
except Exception:
    LICENSED = False

_OPEN = {"state": "open", "canExport": True, "daysLeft": None, "expiry": None, "machine": None, "message": "", "contact": ""}
BROKEN = "程序文件不完整（试用与激活模块缺失或损坏），导出已锁定。请重新下载安装包。"


def module_kind() -> str:
    """验证模块是哪种：native（编译成机器码）/ python（源码）/ none（没有）。打包自检用。"""
    if _impl is None:
        return "none"
    return "python" if str(getattr(_impl, "__file__", "")).endswith((".py", ".pyc")) else "native"


def _broken() -> bool:
    return _impl is None and LICENSED and FROZEN


def status() -> dict:
    """当前许可状态。state：open（不限制）/ trial（试用中）/ expired（试用结束）/ active（已激活）。"""
    if _broken():
        return {"state": "expired", "canExport": False, "daysLeft": 0, "expiry": None, "machine": "",
                "message": BROKEN, "contact": "", "broken": True}
    return dict(_OPEN) if _impl is None else _impl.status()


def activate(code: str) -> dict:
    if _broken():
        return {**status(), "activated": False}
    return status() if _impl is None else _impl.activate(code)


def require_export():
    """导出前调用：没有许可就抛 LicenseError（带给用户看的说明）。"""
    st = status()
    if not st.get("canExport"):
        raise LicenseError(st.get("message") or "试用已结束，导出需要先激活。")


class LicenseError(Exception):
    pass
