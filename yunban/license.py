"""使用许可（试用与激活）的入口。

公开源码里只有这个入口。真正的试用、激活验证在 `_license_impl.py` 里，那个文件不在公开仓库中，
只在打包正式安装包时放进去。没有它的时候（比如用公开源码自己运行），程序不做任何限制。
"""
from __future__ import annotations

try:
    from . import _license_impl as _impl
except ImportError:          # 公开源码版：没有许可模块，不限制
    _impl = None

_OPEN = {"state": "open", "canExport": True, "daysLeft": None, "expiry": None, "machine": None, "message": "", "contact": ""}


def status() -> dict:
    """当前许可状态。state：open（不限制）/ trial（试用中）/ expired（试用结束）/ active（已激活）。"""
    return dict(_OPEN) if _impl is None else _impl.status()


def activate(code: str) -> dict:
    return status() if _impl is None else _impl.activate(code)


def require_export():
    """导出前调用：没有许可就抛 LicenseError（带给用户看的说明）。"""
    st = status()
    if not st.get("canExport"):
        raise LicenseError(st.get("message") or "试用已结束，导出需要先激活。")


class LicenseError(Exception):
    pass
