// 生成演示用名单 演示名单.xlsx（虚构数据，与页面上「载入演示数据」是同一份）
// 用法: node scripts/gen_demo.js
const XLSX = require("../yunban/ui/xlsx.full.min.js");
const Demo = require("../yunban/ui/demo.js");
const path = require("path");
XLSX.set_fs(require("fs"));

const aoa = Demo.build();
const ws = XLSX.utils.aoa_to_sheet(aoa);
ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Demo.HEADER.length - 1 } }];
ws["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 12 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, Demo.SHEET);
const out = path.join(__dirname, "..", "演示名单.xlsx");
XLSX.writeFile(wb, out);
console.log("已生成", out, "共", aoa.length - 3, "人");
