<p align="center"><img src="packaging/icon.png" width="96" alt="匀班"></p>

# 匀班 · 学生均衡分班

把一份 Excel 学生名单，自动分成若干个**成绩、人数、男女都均衡**的班，导出 Excel 和带图表的 PDF 报告。适用于任意年级，科目自选、数量不限，没有成绩也能分。Windows / Mac 下载即用。

- **不用安装**：下载、解压、双击打开
- **数据不出本机**：程序不联网，学生名单只在这台电脑上处理
- **结果可复现**：同一份名单、同样的设置、同一个随机种子，结果完全相同

## 一、下载和打开

到 [Releases](https://github.com/lumanman996/class-assignment-tool/releases) 下载：

- **Windows**：`yunban-Windows.zip`，解压后双击 `匀班.exe`
- **Mac**：`yunban-Mac.zip`，解压后双击 `匀班`

> 第一次打开系统可能会拦一下：Windows 点"更多信息"→"仍要运行"；Mac 到"系统设置 → 隐私与安全性"里点"仍要打开"。

**试用与激活**：下载的安装包第一次打开起免费试用 3 天；到期后仍可分班、查看结果、保存方案，导出 Excel 和 PDF 需要激活码。
激活码按电脑发放：在软件右上角点「输入激活码」，把显示的机器码发给管理员（见下面的[联系方式](#联系方式)）。

## 二、怎么用

按界面顶部的五个步骤操作：**导入 → 设置 → 约束 → 结果 → 导出**。

没有名单可以先点「载入演示数据」体验（257 名虚构学生）。详细步骤见 [使用手册](docs/使用手册.md)，分班原理见 [算法说明](docs/算法说明.md)。

## 三、功能

| 类别 | 功能 |
|---|---|
| 导入 | 自动识别姓名、性别、成绩列；可选工作表和表头行；性别支持 男/女、男生/女生、M/F |
| 均衡 | 任意科目、可设权重；满分不同的科目同等对待；缺成绩的学生照常参与；无成绩模式 |
| 打散 | 同一毕业学校、同一原班级的学生平均分到各班 |
| 约束 | 必须同班、必须分开、指定班级 |
| 结果 | 均衡评分、各科差距条形图、单班表格和全部班级并排两种视图 |
| 调班 | 对调（自动推荐水平最接近的同性别学生）或移动；并排视图可拖动；可逐步撤销 |
| 班主任 | 随机抽签决定每位班主任带哪个班 |
| 导出 | 分班结果 Excel、分班报告 PDF（总览 + 每班一页）、各班名单 PDF、编班结果公示 PDF、方案文件 |
| 界面 | 深色模式、大屏模式（适合投影）、内置使用说明 |

导出的文件在数据文件夹的 `output` 里：Windows 是程序所在文件夹，Mac 是"文稿 / 匀班"。

## 四、用源码运行

需要 Python 3.10 或更高版本。用源码运行的是不带试用限制的开源版本。

```
pip install -r requirements.txt
python -m yunban              # 打开程序窗口
python -m yunban --browser    # 没有窗口组件时，用浏览器打开界面
```

## 五、项目结构

```
yunban/             程序
  ui/               界面（原生 JS，无依赖）
    index.html      页面
    app.js          页面逻辑
    algo.js         分班核心算法（界面与测试共用）
    demo.js         演示名单生成器
    xlsx.full.min.js  SheetJS，读写 Excel
    wechat.png      帮助里「联系作者」用的微信二维码
  server.py         只在本机监听的小服务：提供界面，替界面保存文件、生成 PDF、检查许可
  gui.py            用 pywebview 开程序窗口；没有窗口组件时退回浏览器
  pdf.py            调用电脑上已有的 Edge / Chrome 把页面打印成 PDF
  license.py        试用与激活的入口（公开）；真正的验证在 _license_impl.py（不入库）
  paths.py          数据文件夹在哪里
  app.py            总入口
packaging/          打包成免安装程序的脚本、图标、发布说明
.github/workflows/  自动测试、打包、发布
tests/              算法测试（node）和外壳程序测试（pytest）
docs/               使用手册、算法说明
scripts/ tools/     生成示例数据、图标
```

开发时常用：

```
node tests/test_algo.js           # 算法测试
python -m pytest -q               # 外壳程序测试
python packaging/build.py         # 打包当前系统的免安装程序
python packaging/smoke_test.py    # 用打好的程序自检
```

## 六、隐私

程序不联网，学生数据不会离开你的电脑。仓库内的 Excel 均为脚本随机生成的**虚构数据**。

`.gitignore` 已排除 `output/`、`真实名单*.xlsx`、`*新生名单*.xlsx`、`分班结果*.xlsx`、`匀班方案*.json` 等。方案文件里包含完整名单，**请勿把含真实学生信息的文件提交到公开仓库**。
试用与激活的验证模块不在本仓库中，只在打包正式安装包时加入。

## 联系方式

如有问题、建议或需要激活码，欢迎通过以下方式联系：

- **邮箱**：zhaihuibo@gmail.com
- **微信**：915274394（扫码添加）
- **GitHub Issues**：[提交 Issue](https://github.com/lumanman996/class-assignment-tool/issues)

<p align="center">
  <img src="docs/微信二维码.png" alt="微信二维码" width="200">
</p>

## 许可证

[MIT](LICENSE)：源码可以免费使用、修改、分发。Excel 读写使用 [SheetJS](https://sheetjs.com) 社区版（Apache License 2.0），已随仓库分发并保留原始版权声明。
