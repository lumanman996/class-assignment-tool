// 用用户提供的表头格式生成测试文件: 姓名 性别 毕业学校 语文 数学 英语
const XLSX = require("../xlsx.full.min.js");
XLSX.set_fs(require("fs"));
const path = require("path");
const src = XLSX.readFile(path.join(__dirname, "..", "样例名单.xlsx"));
const rows = XLSX.utils.sheet_to_json(src.Sheets[src.SheetNames[0]]);
// 只保留用户格式的 6 列，且把"毕业小学"改名为"毕业学校"
const out = rows.map(r => ({
  "姓名": r["姓名"], "性别": r["性别"], "毕业学校": r["毕业小学"],
  "语文": r["语文"], "数学": r["数学"], "英语": r["英语"],
}));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), "Sheet1");
const p = path.join(__dirname, "..", "测试-用户表格式.xlsx");
XLSX.writeFile(wb, p);
console.log("已生成", p, "表头:", Object.keys(out[0]).join(" "));
