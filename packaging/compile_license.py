"""把试用与激活的验证模块（yunban/_license_impl.py，不在公开仓库里）编译成机器码，打包时只放编译后的文件。

为什么：打包后的 Python 程序比较容易被还原成源码，有人能把里面的公钥换成自己的、或者改掉试用规则。
编译成机器码（Windows 是 .pyd，Mac 是 .so）后，这些都看不懂、也很难改。对使用者没有任何影响。

build.py 在打包时这样用（没有 _license_impl.py 的公开源码版什么都不做）：
    with compiled_license() as native:
        ...运行 PyInstaller（加上 hidden_imports() 列出的模块）...
进入时：编译出机器码文件，把 .py 暂时挪开（免得 PyInstaller 把源码也打进去），写 yunban/_build_info.py 记下“这是带激活的版本”；
退出时：把 .py 挪回来，删掉编译出的文件和 _build_info.py，项目文件夹恢复原样。
"""
from __future__ import annotations

import ast
import contextlib
import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "yunban"
SRC = PKG / "_license_impl.py"
BUILD_INFO = PKG / "_build_info.py"

SETUP = r'''
from setuptools import setup, Extension
from Cython.Build import cythonize
setup(
    name="yunban-license", script_args=["build_ext", "--inplace", "-q"],
    ext_modules=cythonize(
        [Extension("yunban._license_impl", ["yunban/_license_impl.py"])],
        compiler_directives={"language_level": 3, "annotation_typing": False, "binding": False,
                             "emit_code_comments": False, "embedsignature": False},
        quiet=True, build_dir=__BUILD_DIR__),
)
'''


def compiled_files() -> list[Path]:
    return [p for p in PKG.glob("_license_impl.*") if p.suffix in (".so", ".pyd")]


def hidden_imports() -> list[str]:
    """验证模块里 import 的模块。编译成机器码后 PyInstaller 看不出它用了哪些模块，要明确告诉它。"""
    names = set()
    for node in ast.walk(ast.parse(SRC.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            names.add(node.module)
    names.discard("__future__")
    return sorted(n for n in names if _exists(n))           # winreg 之类只有 Windows 上有


def _exists(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def compile_native() -> Path:
    """编译，返回编译出的文件。"""
    for p in compiled_files():
        p.unlink()
    with tempfile.TemporaryDirectory() as tmp:
        setup_py = Path(tmp) / "setup_license.py"
        setup_py.write_text(SETUP.replace("__BUILD_DIR__", repr(str(Path(tmp) / "c"))), encoding="utf-8")
        subprocess.run([sys.executable, str(setup_py)], cwd=ROOT, check=True)
    for d in list((ROOT / "build").glob("lib.*")) + list((ROOT / "build").glob("temp.*")):   # 编译的中间文件
        shutil.rmtree(d, ignore_errors=True)
    out = compiled_files()
    if len(out) != 1:
        raise SystemExit(f"验证模块没有编译出来：{out}")
    return out[0]


@contextlib.contextmanager
def compiled_license():
    if not SRC.is_file():                       # 公开源码版：没有验证模块，打不限制的版本
        yield None
        return
    native = compile_native()
    stash = Path(tempfile.mkdtemp()) / SRC.name
    shutil.move(str(SRC), str(stash))
    BUILD_INFO.write_text('"""打包时自动生成：这是带试用与激活的正式版本（验证模块缺失时要锁住导出，而不是放开）。"""\n'
                          "LICENSED = True\n", encoding="utf-8")
    try:
        yield native
    finally:
        shutil.move(str(stash), str(SRC))
        BUILD_INFO.unlink(missing_ok=True)
        native.unlink(missing_ok=True)
        for c in PKG.glob("_license_impl.c"):
            c.unlink()


if __name__ == "__main__":                      # 单独试编译：python packaging/compile_license.py
    if not SRC.is_file():
        sys.exit("没有 yunban/_license_impl.py，不用编译。")
    print("已编译：", compile_native())
