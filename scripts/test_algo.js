// 算法验证：读取样例名单，跑分班，检查均衡指标
// 用法: node scripts/test_algo.js [班级数]
const XLSX = require("../xlsx.full.min.js");
XLSX.set_fs(require("fs"));
const Algo = require("../algo.js");
const path = require("path");

const N = parseInt(process.argv[2] || "8", 10);
const wb = XLSX.readFile(path.join(__dirname, "..", "样例名单.xlsx"));
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

// 模拟前端校验：性别必须是男/女，三科必须是数字
const students = [];
let skipped = 0;
for (const r of rows) {
  const g = String(r["性别"] || "").trim();
  const c = Number(r["语文"]), m = Number(r["数学"]), e = Number(r["英语"]);
  if ((g !== "男" && g !== "女") || !isFinite(c) || !isFinite(m) || !isFinite(e) ||
      r["语文"] === "" || r["数学"] === "" || r["英语"] === "" ||
      r["语文"] == null || r["数学"] == null || r["英语"] == null) {
    skipped++; continue;
  }
  students.push({ name: r["姓名"], gender: g, chinese: c, math: m, english: e, total: c + m + e });
}
console.log(`读入 ${rows.length} 行, 有效 ${students.length}, 跳过异常 ${skipped}`);
if (skipped !== 2) { console.error("FAIL: 应跳过 2 行脏数据"); process.exit(1); }

function report(label, assignment) {
  const st = Algo.computeStats(students, assignment, N);
  console.log(`\n=== ${label} ===`);
  console.log("班级  人数  男  女  语文均  数学均  英语均  总分均");
  st.classes.forEach((k, i) => {
    console.log(
      `${String(i + 1).padStart(2)}班  ${String(k.count).padStart(3)}  ${String(k.male).padStart(2)}  ${String(k.female).padStart(2)}` +
      `  ${k.avg_chinese.toFixed(2).padStart(6)}  ${k.avg_math.toFixed(2).padStart(6)}  ${k.avg_english.toFixed(2).padStart(6)}  ${k.avg_total.toFixed(2).padStart(7)}`
    );
  });
  const r = st.ranges;
  console.log(`极差: 人数=${r.count} 男=${r.male} 女=${r.female} 语=${r.avg_chinese.toFixed(2)} 数=${r.avg_math.toFixed(2)} 英=${r.avg_english.toFixed(2)} 总=${r.avg_total.toFixed(2)}`);
  return st;
}

const a1 = Algo.assign(students, N, { seed: 20260823, optimize: false });
const s1 = report("纯蛇形", a1);

const a2 = Algo.assign(students, N, { seed: 20260823, optimize: true });
const s2 = report("蛇形 + 交换优化", a2);

// 断言
const errs = [];
if (s2.ranges.count > 1) errs.push(`班级人数极差 ${s2.ranges.count} > 1`);
if (s2.ranges.male > 2) errs.push(`男生人数极差 ${s2.ranges.male} > 2`);
if (s2.ranges.female > 2) errs.push(`女生人数极差 ${s2.ranges.female} > 2`);
["chinese", "math", "english"].forEach((sub) => {
  if (s2.ranges["avg_" + sub] > 2) errs.push(`${sub} 平均分极差 ${s2.ranges["avg_" + sub].toFixed(2)} > 2`);
});
if (s2.ranges.avg_total > 2) errs.push(`总分平均极差 ${s2.ranges.avg_total.toFixed(2)} > 2`);

const sumRange = (s) => ["chinese", "math", "english", "total"].reduce((t, x) => t + s.ranges["avg_" + x], 0);
if (sumRange(s2) > sumRange(s1) + 1e-9) errs.push("优化后各科极差之和未优于纯蛇形");

// 复现性：同种子结果一致
const a3 = Algo.assign(students, N, { seed: 20260823, optimize: true });
if (JSON.stringify(a2) !== JSON.stringify(a3)) errs.push("同种子结果不可复现");

// 对调候选：同性别 + 按总分接近排序
const cand = Algo.swapCandidates(students, a2, 0, (a2[0] + 1) % N);
if (cand.some((c) => students[c.index].gender !== students[0].gender)) errs.push("对调候选出现异性");
for (let i = 1; i < cand.length; i++) if (cand[i].diff < cand[i - 1].diff) { errs.push("对调候选未按接近度排序"); break; }

if (errs.length) { console.error("\nFAIL:\n" + errs.map((e) => "  - " + e).join("\n")); process.exit(1); }
console.log("\nPASS: 所有均衡指标达标");
