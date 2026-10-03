"""测试用的数据文件夹、许可记录都指到临时目录，不碰真实环境。必须在导入 yunban 之前设置。"""
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="yunban-test-")
os.environ["YUNBAN_HOME"] = os.path.join(_tmp, "home")
os.environ["YUNBAN_LICENSE_DIR"] = os.path.join(_tmp, "lic")
os.environ["YUNBAN_MACHINE"] = "test-machine-1"
os.environ["YUNBAN_NO_OPEN"] = "1"
os.environ["YUNBAN_NO_UPDATE_CHECK"] = "1"
