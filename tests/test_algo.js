// 算法验证：读取样例名单，跑分班，检查均衡指标
// 用法: node tests/test_algo.js [班级数]
const XLSX = require("../yunban/ui/xlsx.full.min.js");
XLSX.set_fs(require("fs"));
const Algo = require("../yunban/ui/algo.js");
const path = require("path");

const N = parseInt(process.argv[2] || "8", 10);
if (!(N >= 6)) { console.error("测试用的约束场景需要至少 6 个班，请传入 ≥ 6 的班级数。"); process.exit(1); }
const SEED = 20260823;
const errs = [];
const sumRange = (st) => Object.values(st.ranges.avg).reduce((t, v) => t + v, 0) + (st.ranges.avgTotal || 0);

function report(label, students, assignment, subjects) {
  const st = Algo.computeStats(students, assignment, N, subjects);
  const f = (v) => (v == null ? "—" : v.toFixed(2)).padStart(7);
  console.log(`\n=== ${label} ===`);
  console.log("班级  人数  男  女  " + subjects.map((s) => s.key + "均").join("  ") + "  总分均");
  st.classes.forEach((k, i) => {
    console.log(`${String(i + 1).padStart(2)}班  ${String(k.count).padStart(3)}  ${String(k.male).padStart(2)}  ${String(k.female).padStart(2)}` +
      subjects.map((s) => f(k.avg[s.key])).join("") + f(k.avgTotal));
  });
  const r = st.ranges;
  console.log(`极差: 人数=${r.count} 男=${r.male} 女=${r.female} ` +
    subjects.map((s) => `${s.key}=${f(r.avg[s.key]).trim()}`).join(" ") + ` 总=${f(r.avgTotal).trim()}`);
  return st;
}

function checkCounts(label, st) {
  if (st.ranges.count > 1) errs.push(`${label}: 班级人数极差 ${st.ranges.count} > 1`);
  if (st.ranges.male > 2) errs.push(`${label}: 男生人数极差 ${st.ranges.male} > 2`);
  if (st.ranges.female > 2) errs.push(`${label}: 女生人数极差 ${st.ranges.female} > 2`);
}

/* ---------- 场景 1：样例名单，语数英三科 ---------- */
const wb = XLSX.readFile(path.join(__dirname, "..", "样例名单.xlsx"));
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
const SUBJ3 = ["语文", "数学", "英语"].map((key) => ({ key }));
const score = (raw) => (raw === "" || raw == null || !isFinite(Number(raw)) ? null : Number(raw));

// 模拟前端校验：性别非法的行剔除；缺成绩的行保留，所缺科目记 null
const students = [];
let skipped = 0;
for (const r of rows) {
  const g = String(r["性别"] || "").trim();
  if (g !== "男" && g !== "女") { skipped++; continue; }
  const scores = {};
  SUBJ3.forEach((s) => { scores[s.key] = score(r[s.key]); });
  students.push({ name: r["姓名"], gender: g, scores });
}
Algo.prepare(students, SUBJ3);
const lacking = students.filter((s) => !s.complete);
console.log(`读入 ${rows.length} 行, 有效 ${students.length}, 剔除异常 ${skipped}, 缺成绩仍参与 ${lacking.length}`);
if (skipped !== 1) errs.push("应剔除 1 行性别非法的数据");
if (lacking.length !== 1 || lacking[0].total !== 175) errs.push("应有 1 名缺成绩学生参与分班，其总分为已有两科之和 175");

const a1 = Algo.assign(students, N, { subjects: SUBJ3, seed: SEED, optimize: false });
const s1 = report("三科：纯蛇形", students, a1, SUBJ3);
const a2 = Algo.assign(students, N, { subjects: SUBJ3, seed: SEED });
const s2 = report("三科：蛇形 + 交换优化", students, a2, SUBJ3);

checkCounts("三科", s2);
SUBJ3.forEach((s) => {
  if (s2.ranges.avg[s.key] > 2) errs.push(`${s.key} 平均分极差 ${s2.ranges.avg[s.key].toFixed(2)} > 2`);
});
if (s2.ranges.avgTotal > 2) errs.push(`总分平均极差 ${s2.ranges.avgTotal.toFixed(2)} > 2`);
if (sumRange(s2) > sumRange(s1) + 1e-9) errs.push("优化后各科极差之和未优于纯蛇形");
if (a2.some((c) => !(c >= 0 && c < N))) errs.push("有学生未分到班");

// 复现性：同种子结果一致
const a3 = Algo.assign(students, N, { subjects: SUBJ3, seed: SEED });
if (JSON.stringify(a2) !== JSON.stringify(a3)) errs.push("同种子结果不可复现");

// 对调候选：同性别 + 按接近度排序
const cand = Algo.swapCandidates(students, a2, 0, (a2[0] + 1) % N);
if (cand.some((c) => students[c.index].gender !== students[0].gender)) errs.push("对调候选出现异性");
for (let i = 1; i < cand.length; i++) if (cand[i].diff < cand[i - 1].diff) { errs.push("对调候选未按接近度排序"); break; }

/* ---------- 场景 2：六科、满分不同（150/150/150/100/100/50）、约 5% 随机缺考 ---------- */
const rng = Algo.makeRng(7);
const SUBJ6 = [["语文", 150], ["数学", 150], ["英语", 150], ["物理", 100], ["历史", 100], ["体育", 50]]
  .map(([key, full]) => ({ key, full }));
const big = [];
for (let i = 0; i < 613; i++) {
  const base = 0.45 + rng() * 0.45;
  const scores = {};
  SUBJ6.forEach((s) => {
    const v = Math.round(s.full * Math.min(1, Math.max(0.1, base + (rng() - 0.5) * 0.3)));
    scores[s.key] = rng() < 0.05 ? null : v;
  });
  big.push({ gender: rng() < 0.52 ? "男" : "女", scores });
}
const b1 = Algo.assign(big, N, { subjects: SUBJ6, seed: SEED, optimize: false });
const t1 = report("六科(满分不同, 含缺考)：纯蛇形", big, b1, SUBJ6);
const b2 = Algo.assign(big, N, { subjects: SUBJ6, seed: SEED });
const t2 = report("六科(满分不同, 含缺考)：蛇形 + 交换优化", big, b2, SUBJ6);
checkCounts("六科", t2);
// 各科极差应不超过该科满分的 1%，小分值科目不能被大分值科目挤掉
SUBJ6.forEach((s) => {
  if (t2.ranges.avg[s.key] > s.full * 0.01) errs.push(`六科: ${s.key} 平均分极差 ${t2.ranges.avg[s.key].toFixed(2)} 超过满分的 1%`);
});
if (sumRange(t2) > sumRange(t1) + 1e-9) errs.push("六科: 优化后各科极差之和未优于纯蛇形");

/* ---------- 场景 3：无成绩模式（如小学一年级），只按性别随机均衡 ---------- */
const plain = big.map((s) => ({ gender: s.gender, scores: {} }));
const p1 = Algo.assign(plain, N, { subjects: [], seed: SEED });
const u1 = report("无成绩模式", plain, p1, []);
checkCounts("无成绩", u1);
if (JSON.stringify(p1) !== JSON.stringify(Algo.assign(plain, N, { subjects: [], seed: SEED }))) errs.push("无成绩: 同种子结果不可复现");
if (JSON.stringify(p1) === JSON.stringify(Algo.assign(plain, N, { subjects: [], seed: SEED + 1 }))) errs.push("无成绩: 换种子后结果应不同");

/* ---------- 场景 4：班级人数。男女人数都不能整除时，各班总人数仍应最多差 1 ---------- */
for (let n = 2; n <= 12; n++) for (let m = 0; m <= 40; m++) for (let f = 0; f <= 40; f += 3) {
  if (m + f < n) continue;
  const st = [];
  for (let i = 0; i < m; i++) st.push({ gender: "男", scores: {} });
  for (let i = 0; i < f; i++) st.push({ gender: "女", scores: {} });
  const r = Algo.computeStats(st, Algo.assign(st, n, { seed: 1 }), n, []).ranges;
  if (r.count > 1 || r.male > 1 || r.female > 1) { errs.push(`人数不均: ${n} 个班, 男 ${m} 女 ${f}, 极差 ${r.count}/${r.male}/${r.female}`); break; }
}

/* ---------- 场景 5：约束（同班 / 分开 / 指定班级）与类别打散 ---------- */
const schools = ["一小", "二小", "三小", "四小", "五小"];
big.forEach((s, i) => { s.cats = { "毕业学校": schools[Math.floor(rng() * rng() * schools.length)] }; });
const cons = [
  { type: "together", members: [0, 1, 2] },
  { type: "apart", members: [3, 4, 5, 6, 7, 8] },
  { type: "lock", members: [9], cls: 5 },
  { type: "lock", members: [0], cls: 2 },   // 同班组整体被指定到 3 班
  { type: "apart", members: [1, 10, 11] },  // 同班组成员同时在分开组里
  { type: "together", members: [20, 21] },
  { type: "apart", members: [20, 22] },
];
const c2 = Algo.assign(big, N, { subjects: SUBJ6, categories: ["毕业学校"], constraints: cons, seed: SEED });
const v2 = report("六科 + 约束 + 毕业学校打散", big, c2, SUBJ6);
const unmet = Algo.checkConstraints(c2, cons);
if (unmet.length) errs.push(`约束未满足: 第 ${unmet.map((i) => i + 1).join("、")} 条`);
if (c2[0] !== 2 || c2[9] !== 5) errs.push("指定班级未生效");
checkCounts("约束", v2);
SUBJ6.forEach((s) => {
  if (v2.ranges.avg[s.key] > s.full * 0.015) errs.push(`约束: ${s.key} 平均分极差 ${v2.ranges.avg[s.key].toFixed(2)} 超过满分的 1.5%`);
});
const spread = (as) => Math.max(...schools.map((sch) => {
  const cnt = new Array(N).fill(0);
  big.forEach((s, i) => { if (s.cats["毕业学校"] === sch) cnt[as[i]]++; });
  return Math.max(...cnt) - Math.min(...cnt);
}));
console.log(`毕业学校各班人数最大差距: 不打散 ${spread(b2)} 人, 打散 ${spread(c2)} 人`);
if (spread(c2) > 2) errs.push(`类别打散后同校学生各班人数差距 ${spread(c2)} > 2`);

// 互相矛盾的约束应报错，而不是悄悄给出错误结果
[
  [{ type: "together", members: [0, 1] }, { type: "apart", members: [0, 1] }],
  [{ type: "lock", members: [0], cls: 0 }, { type: "lock", members: [0], cls: 1 }],
  [{ type: "apart", members: big.slice(0, N + 1).map((_, i) => i) }],
].forEach((bad, i) => {
  try { Algo.assign(big, N, { subjects: SUBJ6, constraints: bad, seed: SEED }); errs.push(`矛盾约束 ${i + 1} 未报错`); }
  catch (e) { /* 预期报错 */ }
});

if (errs.length) { console.error("\nFAIL:\n" + errs.map((e) => "  - " + e).join("\n")); process.exit(1); }
console.log("\nPASS: 所有均衡指标达标");
