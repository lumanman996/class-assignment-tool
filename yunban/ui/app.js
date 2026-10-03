/* 匀班 页面逻辑。算法在 algo.js（FenbanAlgo），Excel 读写用 xlsx.full.min.js（XLSX）。
 * 保存文件、生成 PDF、试用与激活由外壳程序（yunban/server.py）完成，通过 api() 调用。 */
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, bad) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3000);
}

// 调用外壳程序。出错时用提示条显示原因并抛出，调用处不用再处理
let license = { state: "open", canExport: true };
async function api(name, body) {
  let res;
  try {
    res = await (await fetch("/api/" + name, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Token": TOKEN }, body: JSON.stringify(body || {}),
    })).json();
  } catch (err) { toast("程序没有响应，请关掉窗口重新打开。", true); throw err; }
  if (!res.ok) {
    if (res.license) { await refreshLicense(); openLicense(); }
    toast(res.error, true);
    throw new Error(res.error);
  }
  return res.data;
}

const AUTO_PATTERNS = { name: ["姓名", "学生姓名", "名字"], gender: ["性别"] };
const GENDER_WORDS = {
  "男": ["男", "男生", "男性", "m", "male", "boy"],
  "女": ["女", "女生", "女性", "f", "female", "girl"],
};
// 自动勾选成绩列：常见科目名直接勾选；明显不是成绩的数字列（学号、总分、排名等）不勾选
const KNOWN_SUBJECTS = ["语文", "数学", "英语", "外语", "物理", "化学", "生物", "历史", "地理", "政治",
  "道德与法治", "道法", "思想品德", "品德", "科学", "体育", "信息", "音乐", "美术"];
const NOT_SUBJECT = /序号|学号|考号|编号|号码|电话|手机|身份证|年龄|班|总分|合计|总成绩|排名|名次|座位|籍|邮编|日期|出生/;
const STEP_NAMES = ["导入名单", "分班设置", "约束条件", "分班结果", "导出"];
const CONS_LABEL = { together: "必须同班", apart: "必须分开", lock: "指定班级" };

const state = {
  fileName: "", wb: null, sheet: "", headerRow: 1,
  headers: [], rows: [], lines: [],   // lines[i] = rows[i] 在 Excel 中的行号
  mapping: { name: "", gender: "" },
  subjectCols: [],      // 候选成绩列 {key, checked, weight}
  catCols: [],          // 候选类别列 {key, checked}
  subjects: [],         // 参与均衡的科目 {key, weight}，key 即表头名
  categories: [],       // 需要打散的类别列名
  students: [],         // {row, line, name, gender, scores, cats, missing, total, complete, composite}
  invalid: [],
  classCount: 8, seed: 0, optimize: true,
  constraints: [],      // {type, lines:[原表行号], cls, note}
  pending: [],          // 正在添加的约束已选学生（原表行号）
  assignment: null,     // students 下标 -> 班级下标
  currentClass: 0, view: "table",
  adjustLog: [],        // {kind:'swap'|'move', a, b, from, to}，a/b 为 students 下标
  teachers: null, drawCount: 0,
  step: 1, maxStep: 1,
  modal: null,
};

/* ---------- 步骤导航 ---------- */
function renderSteps() {
  const box = $("steps");
  box.innerHTML = "";
  STEP_NAMES.forEach((name, i) => {
    const n = i + 1, b = document.createElement("button");
    b.innerHTML = `<span class="n">${n}</span>${name}`;
    if (n === state.step) b.classList.add("active"); else if (n <= state.maxStep) b.classList.add("done");
    b.disabled = n > state.maxStep;
    b.onclick = () => goto(n);
    box.appendChild(b);
  });
}
function goto(n) {
  state.step = n;
  state.maxStep = Math.max(state.maxStep, n);
  for (let i = 1; i <= 5; i++) $("p" + i).classList.toggle("hidden", i !== n);
  if (n === 2) updateTplPreview();
  if (n === 3) renderConstraints();
  if (n === 4) renderResult();
  renderSteps();
  window.scrollTo({ top: 0 });
}
// 名单或设置变了，旧的分班结果作废
function invalidateResult() {
  state.assignment = null; state.adjustLog = []; state.teachers = null; state.drawCount = 0;
  state.maxStep = Math.min(state.maxStep, 3);
  renderSteps();
}
$("next-1").onclick = () => goto(2);
$("prev-2").onclick = () => goto(1);
$("next-2").onclick = () => goto(3);
$("prev-3").onclick = () => goto(2);
$("prev-4").onclick = () => goto(2);
$("next-4").onclick = () => goto(5);
$("prev-5").onclick = () => goto(4);
$("run-2").onclick = run;
$("run-3").onclick = run;

/* ---------- 第 1 步：导入 ---------- */
$("btn-pick").onclick = () => $("file-input").click();
$("file-input").onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; };
const dz = $("dropzone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
dz.addEventListener("drop", (e) => {
  e.preventDefault(); dz.classList.remove("dragover");
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

// 演示数据：在内存里生成一份 Excel，走和真实文件完全相同的导入流程
$("btn-demo").onclick = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(YunbanDemo.build()), YunbanDemo.SHEET);
  $("grade").value = "七年级";
  $("class-count").value = 6;
  loadFile(new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], "演示名单.xlsx"));
  toast("已载入演示数据：257 名虚构学生");
};

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let wb;
    try { wb = XLSX.read(e.target.result, { type: "array" }); }
    catch (err) { toast("文件读取失败，请确认是有效的 Excel 文件。", true); return; }
    state.wb = wb;
    state.fileName = file.name;
    // 默认选第一个能找到"姓名"表头的工作表
    state.sheet = wb.SheetNames.find((n) => detectHeaderRow(wb.Sheets[n]) > 0) || wb.SheetNames[0];
    state.headerRow = detectHeaderRow(wb.Sheets[state.sheet]) || 1;
    state.constraints = []; state.pending = [];
    state.maxStep = 1;
    readSheet();
    goto(1);
  };
  reader.readAsArrayBuffer(file);
}

// 表头行 = 前 20 行中第一个出现"姓名"的行；找不到返回 0
function detectHeaderRow(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: true }).slice(0, 20);
  const i = aoa.findIndex((r) => r.some((c) => String(c).replace(/\s/g, "").includes("姓名")));
  return i + 1;
}

function readSheet() {
  const raw = XLSX.utils.sheet_to_json(state.wb.Sheets[state.sheet], { defval: "", range: state.headerRow - 1 });
  state.lines = raw.map((r) => r.__rowNum__ + 1);
  state.rows = raw.map((r) => ({ ...r }));
  state.headers = raw.length ? Object.keys(raw[0]) : [];
  if (!raw.length) toast("这个工作表在表头行下面没有数据，请检查工作表和表头行。", true);
  autoMap();
  detectCols();
  renderImport();
  revalidate();
}

function autoMap() {
  for (const key of ["name", "gender"]) {
    const clean = (h) => h.replace(/\s/g, "");
    const exact = state.headers.find((h) => AUTO_PATTERNS[key].includes(clean(h)));
    const fuzzy = state.headers.find((h) => AUTO_PATTERNS[key].some((p) => clean(h).includes(p)));
    state.mapping[key] = exact || fuzzy || "";
  }
}

// 成绩单元格 -> 数字；空白、"缺考"等非数字一律视为缺成绩(null)
function parseScore(raw) {
  if (raw === "" || raw == null) return null;
  const t = typeof raw === "string" ? raw.trim() : raw;
  if (t === "") return null;
  const v = Number(t);
  return isFinite(v) ? v : null;
}
function normGender(raw) {
  const t = String(raw == null ? "" : raw).trim().toLowerCase();
  for (const g of Object.keys(GENDER_WORDS)) if (GENDER_WORDS[g].includes(t)) return g;
  return "";
}

// 候选成绩列 = 大部分是数字的列；候选类别列 = 取值种类不多的列
function detectCols() {
  state.subjectCols = []; state.catCols = [];
  for (const h of state.headers) {
    let filled = 0, numeric = 0;
    const distinct = new Set();
    for (const row of state.rows) {
      const t = String(row[h]).trim();
      if (t === "") continue;
      filled++; distinct.add(t);
      if (parseScore(row[h]) != null) numeric++;
    }
    if (!filled) continue;
    if (numeric / filled >= 0.5) {
      const known = KNOWN_SUBJECTS.some((k) => h.includes(k));
      state.subjectCols.push({ key: h, weight: 1,
        checked: !NOT_SUBJECT.test(h) && (known || numeric / filled >= 0.8) });
    }
    if (distinct.size >= 2 && distinct.size <= 40 && distinct.size <= filled / 3 && !/总分|合计|总成绩|排名|名次/.test(h)) {
      state.catCols.push({ key: h, checked: false });
    }
  }
}

const notMapped = (c) => c.key !== state.mapping.name && c.key !== state.mapping.gender;

function renderImport() {
  $("import-result").classList.remove("hidden");
  $("file-info").innerHTML = `已读取 <strong>${esc(state.fileName)}</strong>，共 ${state.rows.length} 行。请确认下面的对应关系：`;
  $("sheet-field").classList.toggle("hidden", !state.wb);
  $("header-field").classList.toggle("hidden", !state.wb);
  if (state.wb) {
    const sel = $("sheet-select");
    sel.innerHTML = "";
    state.wb.SheetNames.forEach((n) => sel.add(new Option(n, n, false, n === state.sheet)));
    $("header-row").value = state.headerRow;
  }
  for (const key of ["name", "gender"]) {
    const sel = $("map-" + key);
    sel.innerHTML = "";
    sel.add(new Option("（未选择）", ""));
    state.headers.forEach((h) => sel.add(new Option(h, h, false, h === state.mapping[key])));
    sel.onchange = () => { state.mapping[key] = sel.value; renderCols(); revalidate(); };
  }
  renderCols();
}
$("sheet-select").onchange = (e) => {
  state.sheet = e.target.value;
  state.headerRow = detectHeaderRow(state.wb.Sheets[state.sheet]) || 1;
  state.constraints = [];
  readSheet();
};
$("header-row").onchange = (e) => {
  const v = parseInt(e.target.value, 10);
  if (!(v >= 1)) { e.target.value = state.headerRow; return; }
  state.headerRow = v;
  state.constraints = [];
  readSheet();
};

function renderCols() {
  const sbox = $("subjects");
  sbox.innerHTML = "";
  const cols = state.subjectCols.filter(notMapped);
  if (!cols.length) sbox.innerHTML = `<span class="muted">表格中没有发现数字成绩列。</span>`;
  for (const c of cols) {
    const label = document.createElement("label");
    label.className = "chip" + (c.checked ? " on" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = c.checked;
    cb.onchange = () => { c.checked = cb.checked; renderCols(); revalidate(); };
    label.append(cb, c.key);
    if (c.checked) {
      const w = document.createElement("input");
      w.type = "number"; w.min = "0"; w.step = "0.5"; w.value = c.weight; w.title = "权重";
      w.onchange = () => {
        const v = Number(w.value);
        c.weight = isFinite(v) && v >= 0 ? v : 1;
        w.value = c.weight;
        revalidate();
      };
      label.append(" 权重", w);
    }
    sbox.appendChild(label);
  }

  const cbox = $("cats");
  cbox.innerHTML = "";
  const subjectKeys = new Set(state.subjectCols.filter((c) => c.checked).map((c) => c.key));
  const cats = state.catCols.filter((c) => notMapped(c) && !subjectKeys.has(c.key));
  if (!cats.length) cbox.innerHTML = `<span class="muted">表格中没有适合打散的类别列。</span>`;
  for (const c of cats) {
    const label = document.createElement("label");
    label.className = "chip" + (c.checked ? " on" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = c.checked;
    cb.onchange = () => { c.checked = cb.checked; renderCols(); revalidate(); };
    label.append(cb, c.key);
    cbox.appendChild(label);
  }
}

function revalidate() {
  const m = state.mapping;
  invalidateResult();
  const missingCols = [["name", "姓名"], ["gender", "性别"]].filter((f) => !m[f[0]]).map((f) => f[1]);
  if (missingCols.length) {
    $("validate-summary").innerHTML = `<span class="pill bad">请先指定列：${missingCols.join("、")}</span>`;
    $("invalid-box").classList.add("hidden");
    $("missing-box").classList.add("hidden");
    state.students = [];
    $("next-1").disabled = true;
    state.maxStep = 1; renderSteps();
    return;
  }
  const subjects = state.subjectCols.filter((c) => c.checked && notMapped(c)).map((c) => ({ key: c.key, weight: c.weight }));
  const subjectKeys = new Set(subjects.map((s) => s.key));
  const categories = state.catCols.filter((c) => c.checked && notMapped(c) && !subjectKeys.has(c.key)).map((c) => c.key);
  const students = [], invalid = [];
  state.rows.forEach((row, i) => {
    const line = state.lines[i];
    const name = String(row[m.name]).trim();
    const rawGender = String(row[m.gender]).trim();
    const gender = normGender(rawGender);
    const reasons = [];
    if (!name) reasons.push("姓名为空");
    if (!gender) reasons.push(`性别应为"男"或"女"（当前：${rawGender || "空"}）`);
    if (reasons.length) { invalid.push({ line, name: name || "（无姓名）", reason: reasons.join("；") }); return; }
    const scores = {}, cats = {}, missing = [];
    for (const sub of subjects) {
      scores[sub.key] = parseScore(row[sub.key]);
      if (scores[sub.key] == null) missing.push(sub.key);
    }
    for (const key of categories) cats[key] = String(row[key]).trim();
    students.push({ row, line, name, gender, scores, cats, missing });
  });
  FenbanAlgo.prepare(students, subjects);
  Object.assign(state, { subjects, categories, students, invalid });

  const male = students.filter((s) => s.gender === "男").length;
  const lacking = students.filter((s) => s.missing.length);
  let html = `<span class="pill ok">有效学生 ${students.length} 人（男 ${male}，女 ${students.length - male}）</span> `;
  html += subjects.length
    ? `<span class="pill ok">均衡科目 ${subjects.length} 科：${subjects.map((s) => esc(s.key)).join("、")}</span>`
    : `<span class="pill warn">未选成绩科目：按「无成绩模式」分班，只保证人数与性别均衡</span>`;
  if (categories.length) html += ` <span class="pill ok">打散类别：${categories.map(esc).join("、")}</span>`;
  if (lacking.length) html += ` <span class="pill warn">缺部分成绩 ${lacking.length} 人（仍参与分班）</span>`;
  if (invalid.length) html += ` <span class="pill bad">异常 ${invalid.length} 行（不参与分班）</span>`;
  $("validate-summary").innerHTML = html;

  $("invalid-box").classList.toggle("hidden", !invalid.length);
  $("invalid-table").innerHTML = `<tr><th>Excel 行号</th><th>姓名</th><th>问题</th></tr>` +
    invalid.map((v) => `<tr><td>${v.line}</td><td>${esc(v.name)}</td><td style="text-align:left">${esc(v.reason)}</td></tr>`).join("");

  const SHOW = 100;
  $("missing-box").classList.toggle("hidden", !lacking.length);
  $("missing-table").innerHTML = `<tr><th>Excel 行号</th><th>姓名</th><th>缺少的科目</th></tr>` +
    lacking.slice(0, SHOW).map((s) => `<tr><td>${s.line}</td><td>${esc(s.name)}</td><td style="text-align:left">${esc(s.missing.join("、"))}</td></tr>`).join("") +
    (lacking.length > SHOW ? `<tr><td colspan="3" class="muted">…… 另有 ${lacking.length - SHOW} 人未列出</td></tr>` : "");

  $("next-1").disabled = students.length < 2;
  if (students.length < 2) { state.maxStep = 1; renderSteps(); }
  $("opt-optimize").disabled = !subjects.length && !categories.length;
  if (!$("seed").value) $("seed").value = randomSeed();
}

/* ---------- 第 2 步：设置 ---------- */
const gradeName = () => $("grade").value.trim() || "七年级";
function clsName(i) {
  let tpl = $("class-tpl").value.trim() || "{n}班";
  if (!/\{nn?\}/.test(tpl)) tpl += "{n}"; // 没写班号占位符时补上，避免各班重名
  return tpl.replace(/\{nn\}/g, String(i + 1).padStart(2, "0"))
    .replace(/\{n\}/g, i + 1).replace(/\{年级\}/g, gradeName());
}
function updateTplPreview() {
  $("class-tpl-preview").textContent = `示例：${clsName(0)}、${clsName(1)}……`;
}
for (const id of ["grade", "class-tpl"]) $(id).oninput = updateTplPreview;
for (const id of ["class-count", "seed", "opt-optimize"]) $(id).onchange = invalidateResult;

function randomSeed() { return Math.floor(Math.random() * 900000) + 100000; }
$("btn-reseed").onclick = () => { $("seed").value = randomSeed(); invalidateResult(); };
$("rerun").onclick = () => { $("seed").value = randomSeed(); run(); };

function run() {
  const n = parseInt($("class-count").value, 10);
  if (!(n >= 2 && n <= 40)) { toast("班级数量请填 2～40 之间的整数。", true); return; }
  if (n > state.students.length) { toast("班级数量不能超过学生人数。", true); return; }
  const seed = parseInt($("seed").value, 10) || randomSeed();
  const optimize = $("opt-optimize").checked;
  let assignment;
  try {
    assignment = FenbanAlgo.assign(state.students, n, {
      subjects: state.subjects, categories: state.categories,
      constraints: resolveConstraints(), seed, optimize,
    });
  } catch (err) { toast(err.message, true); return; }
  $("seed").value = seed;
  Object.assign(state, { classCount: n, seed, optimize, assignment,
    adjustLog: [], teachers: null, drawCount: 0, currentClass: 0 });
  goto(4);
}

/* ---------- 第 3 步：约束 ---------- */
const byLine = () => new Map(state.students.map((s, i) => [s.line, i]));
const stuLabel = (s) => `${s.name} · 第${s.line}行`;

// 把按行号保存的约束换成算法需要的学生下标；找不到的学生忽略，人数不够的约束忽略
function resolveConstraints() {
  const idx = byLine();
  return state.constraints.map((c) => ({
    type: c.type, cls: c.cls, src: c,
    members: c.lines.filter((l) => idx.has(l)).map((l) => idx.get(l)),
  })).filter((c) => c.members.length >= (c.type === "lock" ? 1 : 2));
}

function consText(c) {
  const idx = byLine();
  const names = c.lines.map((l) => (idx.has(l) ? stuLabel(state.students[idx.get(l)]) : `第${l}行（不在名单中）`)).join("、");
  return names + (c.type === "lock" ? ` → ${clsName(c.cls)}` : "");
}

function renderConstraints() {
  const dl = $("cons-students");
  dl.innerHTML = "";
  state.students.forEach((s) => dl.appendChild(new Option(stuLabel(s))));
  const sel = $("cons-cls"), n = parseInt($("class-count").value, 10) || 0;
  sel.innerHTML = "";
  for (let i = 0; i < n; i++) sel.add(new Option(clsName(i), i));
  $("cons-cls-field").classList.toggle("hidden", $("cons-type").value !== "lock");

  const idx = byLine(), pend = $("cons-pending");
  state.pending = state.pending.filter((l) => idx.has(l));
  pend.innerHTML = state.pending.length ? "" : `<span class="muted">还没有选学生。</span>`;
  state.pending.forEach((line, k) => {
    const chip = document.createElement("span");
    chip.className = "chip on";
    chip.append(stuLabel(state.students[idx.get(line)]));
    const x = document.createElement("button");
    x.className = "small"; x.textContent = "移除";
    x.onclick = () => { state.pending.splice(k, 1); renderConstraints(); };
    chip.appendChild(x);
    pend.appendChild(chip);
  });

  const ul = $("cons-list");
  ul.innerHTML = "";
  state.constraints.forEach((c, k) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="pill warn t">${CONS_LABEL[c.type]}</span><span class="m">${esc(consText(c))}` +
      (c.note ? ` <span class="muted">（${esc(c.note)}）</span>` : "") + `</span>`;
    const del = document.createElement("button");
    del.className = "small"; del.textContent = "删除";
    del.onclick = () => { state.constraints.splice(k, 1); invalidateResult(); renderConstraints(); };
    li.appendChild(del);
    ul.appendChild(li);
  });
}
$("cons-type").onchange = renderConstraints;
$("cons-search").oninput = (e) => {
  const s = state.students.find((x) => stuLabel(x) === e.target.value);
  if (!s) return;
  if (!state.pending.includes(s.line)) state.pending.push(s.line);
  e.target.value = "";
  renderConstraints();
};
$("cons-add").onclick = () => {
  const type = $("cons-type").value;
  const need = type === "lock" ? 1 : 2;
  if (state.pending.length < need) { toast(`「${CONS_LABEL[type]}」至少需要选 ${need} 名学生。`, true); return; }
  state.constraints.push({ type, lines: state.pending.slice(), note: $("cons-note").value.trim(),
    cls: type === "lock" ? parseInt($("cons-cls").value, 10) : null });
  state.pending = [];
  $("cons-note").value = "";
  invalidateResult();
  renderConstraints();
};

/* ---------- 第 4 步：结果 ---------- */
const fmt = (v) => (v == null ? "—" : v.toFixed(2));
const num = (v) => (v == null ? "" : +v.toFixed(2)); // 导出 Excel 用
const showTotal = () => state.subjects.length > 1;
const scoreCell = (v) => (v == null ? "—" : v);
const totalCell = (s) => (s.total == null ? "—" : s.total + (s.complete ? "" : "*"));
const stats = () => FenbanAlgo.computeStats(state.students, state.assignment, state.classCount, state.subjects);
const members = (c) => state.students.map((s, i) => ({ s, i })).filter((x) => state.assignment[x.i] === c);
// 班内排序：按成绩（总分高在前，无成绩排最后）/ 按姓名 / 按原表顺序
const SORTERS = {
  score: (a, b) => (b.s.total == null ? -Infinity : b.s.total) - (a.s.total == null ? -Infinity : a.s.total) || a.s.line - b.s.line,
  name: (a, b) => a.s.name.localeCompare(b.s.name, "zh-Hans-CN") || a.s.line - b.s.line,
  orig: (a, b) => a.s.line - b.s.line,
};

function sdOf(values) {
  const vs = values.filter((v) => v != null);
  if (!vs.length) return 0;
  const mean = vs.reduce((t, v) => t + v, 0) / vs.length;
  return Math.sqrt(vs.reduce((t, v) => t + (v - mean) * (v - mean), 0) / vs.length);
}

// 均衡度表的成绩列：[{label, cls: 班级行取值, rng: 极差, sd: 全体学生该项的标准差}]
function avgColumns(st) {
  const cols = state.subjects.map((sub) => ({
    label: sub.key + "平均", cls: (k) => k.avg[sub.key], rng: st.ranges.avg[sub.key],
    sd: sdOf(state.students.map((s) => s.scores[sub.key])),
  }));
  if (showTotal()) cols.push({ label: "总分平均", cls: (k) => k.avgTotal, rng: st.ranges.avgTotal,
    sd: sdOf(state.students.map((s) => (s.complete ? s.total : null))) });
  return cols;
}

/* 均衡评分（0～100）：各科「班级间平均分差距 ÷ 该科学生成绩标准差」的平均值每 1% 扣 1 分；
 * 人数、男、女的班级间差距超过 1 人的部分，每人扣 3 分。 */
function balance(st, cols) {
  const r = st.ranges;
  const ratios = cols.filter((c) => c.rng != null && c.sd > 0).map((c) => c.rng / c.sd);
  const mean = ratios.length ? ratios.reduce((t, v) => t + v, 0) / ratios.length : 0;
  const extra = [r.count, r.male, r.female].reduce((t, v) => t + Math.max(0, v - 1), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - 100 * mean - 3 * extra)));
  const rows = [["班级人数", r.count], ["男生人数", r.male], ["女生人数", r.female]]
    .map(([label, v]) => ({ label, text: `最多相差 ${v} 人`, ratio: v <= 1 ? v * 0.02 : v * 0.1 }));
  cols.forEach((c) => {
    if (c.rng != null) rows.push({ label: c.label, text: `最多相差 ${fmt(c.rng)} 分`, ratio: c.sd > 0 ? c.rng / c.sd : 0 });
  });
  return { score, rows };
}

function renderResult() {
  if (!state.assignment) return;
  renderStats(); renderViolations(); renderView(); renderLog();
}

function renderStats() {
  const st = stats(), cols = avgColumns(st), r = st.ranges, bal = balance(st, cols);
  $("score-num").textContent = bal.score;
  $("score-label").innerHTML = bal.score >= 95 ? `<span class="pill ok">优</span>`
    : bal.score >= 85 ? `<span class="pill ok">良</span>`
    : bal.score >= 70 ? `<span class="pill warn">一般</span>` : `<span class="pill bad">较差</span>`;
  $("score-bars").innerHTML = bal.rows.map((x) => {
    const w = Math.max(2, Math.min(100, x.ratio / 0.3 * 100));
    const cls = x.ratio < 0.05 ? "" : x.ratio < 0.15 ? "mid" : "high";
    return `<span>${esc(x.label)}</span><span class="bar"><i class="${cls}" style="width:${w}%"></i></span><span class="muted">${x.text}</span>`;
  }).join("");

  const t = state.teachers;
  let html = `<tr><th>班级</th>${t ? "<th>班主任</th>" : ""}<th>人数</th><th>男</th><th>女</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>`;
  st.classes.forEach((k, i) => {
    html += `<tr><td>${esc(clsName(i))}</td>${t ? `<td>${esc(t[i])}</td>` : ""}<td>${k.count}</td><td>${k.male}</td><td>${k.female}</td>` +
      cols.map((c) => `<td>${fmt(c.cls(k))}</td>`).join("") + `</tr>`;
  });
  html += `<tr class="range-row"><td>班级间差距</td>${t ? "<td></td>" : ""}<td>${r.count}</td><td>${r.male}</td><td>${r.female}</td>` +
    cols.map((c) => `<td>${fmt(c.rng)}</td>`).join("") + `</tr>`;
  $("stats-table").innerHTML = html;

  // 类别打散情况：同一取值在各班人数的最大差距
  $("cat-stats").innerHTML = state.categories.map((key) => {
    const counts = {};
    state.students.forEach((s, i) => {
      const v = s.cats[key];
      if (v) (counts[v] = counts[v] || new Array(state.classCount).fill(0))[state.assignment[i]]++;
    });
    const worst = Math.max(0, ...Object.values(counts).map((a) => Math.max(...a) - Math.min(...a)));
    return `「${esc(key)}」已打散：同一${esc(key)}的学生在各班的人数最多相差 ${worst} 人。`;
  }).join("<br>");
}

function renderViolations() {
  const res = resolveConstraints();
  const bad = FenbanAlgo.checkConstraints(state.assignment, res);
  $("violations").innerHTML = bad.length
    ? `<div class="box warn">当前结果不满足以下 ${bad.length} 条约束：<br>` +
      bad.map((i) => `${CONS_LABEL[res[i].type]}：${esc(consText(res[i].src))}`).join("<br>") + `</div>`
    : "";
}

function renderView() {
  const board = state.view === "board";
  $("table-view").classList.toggle("hidden", board);
  $("board-view").classList.toggle("hidden", !board);
  $("view-table").disabled = !board;
  $("view-board").disabled = board;
  if (board) renderBoard(); else { renderTabs(); renderRoster(); }
}
$("view-table").onclick = () => { state.view = "table"; renderView(); };
$("view-board").onclick = () => { state.view = "board"; renderView(); };

function renderTabs() {
  const box = $("class-tabs");
  box.innerHTML = "";
  for (let i = 0; i < state.classCount; i++) {
    const b = document.createElement("button");
    b.textContent = clsName(i);
    if (i === state.currentClass) b.classList.add("active");
    b.onclick = () => { state.currentClass = i; renderTabs(); renderRoster(); };
    box.appendChild(b);
  }
}

function renderRoster() {
  const list = members(state.currentClass).sort(SORTERS.score);
  const subs = state.subjects;
  let html = `<tr><th>序号</th><th>姓名</th><th>性别</th>${subs.map((s) => `<th>${esc(s.key)}</th>`).join("")}` +
    (showTotal() ? `<th>总分</th>` : "") +
    `<th title="学生在原始 Excel 中的行号，便于核对重名学生">原表行号</th><th>操作</th></tr>`;
  list.forEach((x, n) => {
    const g = x.s.gender;
    html += `<tr><td>${n + 1}</td><td>${esc(x.s.name)}</td>` +
      `<td class="${g === "男" ? "male" : "female"}">${g}</td>` +
      subs.map((s) => `<td>${scoreCell(x.s.scores[s.key])}</td>`).join("") +
      (showTotal() ? `<td><strong>${totalCell(x.s)}</strong></td>` : "") +
      `<td class="muted">${x.s.line}</td>` +
      `<td><button class="small" data-i="${x.i}">调班</button></td></tr>`;
  });
  $("roster-table").innerHTML = html;
  $("roster-table").querySelectorAll("button[data-i]").forEach((b) => { b.onclick = () => openModal(+b.dataset.i); });
  $("roster-note").classList.toggle("hidden", !(showTotal() && list.some((x) => x.s.total != null && !x.s.complete)));
}

// 全部班级并排：拖到学生身上 = 对调，拖到班级空白处 = 移动
function renderBoard() {
  const box = $("board"), st = stats();
  box.innerHTML = "";
  for (let c = 0; c < state.classCount; c++) {
    const col = document.createElement("div");
    col.className = "col";
    const k = st.classes[c];
    col.innerHTML = `<h4>${esc(clsName(c))}<small>${k.count} 人 · 男 ${k.male} 女 ${k.female}</small></h4>`;
    col.ondragover = (e) => { e.preventDefault(); col.classList.add("over"); };
    col.ondragleave = () => col.classList.remove("over");
    col.ondrop = (e) => {
      e.preventDefault();
      const a = +e.dataTransfer.getData("text/plain");
      if (state.assignment[a] !== c) doMove(a, c);
    };
    members(c).sort(SORTERS.score).forEach((x) => {
      const el = document.createElement("div");
      el.className = "stu";
      el.draggable = true;
      el.innerHTML = `<span class="${x.s.gender === "男" ? "male" : "female"}">${esc(x.s.name)}</span>` +
        `<span>${state.subjects.length ? totalCell(x.s) : ""}</span>`;
      el.title = `${x.s.gender}，原表第 ${x.s.line} 行`;
      el.onclick = () => openModal(x.i);
      el.ondragstart = (e) => e.dataTransfer.setData("text/plain", String(x.i));
      el.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("over"); };
      el.ondragleave = () => el.classList.remove("over");
      el.ondrop = (e) => {
        e.preventDefault(); e.stopPropagation();
        const a = +e.dataTransfer.getData("text/plain");
        if (state.assignment[a] !== c) doSwap(a, x.i);
      };
      col.appendChild(el);
    });
    box.appendChild(col);
  }
}

/* 手动调整：记录为数据，只能从最后一步往回撤销，保证撤销后状态一定正确 */
function doSwap(a, b) {
  const from = state.assignment[a], to = state.assignment[b];
  state.assignment[a] = to; state.assignment[b] = from;
  state.adjustLog.push({ kind: "swap", a, b, from, to });
  renderResult();
}
function doMove(a, to) {
  const from = state.assignment[a];
  state.assignment[a] = to;
  state.adjustLog.push({ kind: "move", a, from, to });
  renderResult();
}
$("btn-undo").onclick = () => {
  const e = state.adjustLog.pop();
  if (!e) return;
  state.assignment[e.a] = e.from;
  if (e.kind === "swap") state.assignment[e.b] = e.to;
  renderResult();
};
function logText(e) {
  const A = state.students[e.a];
  if (e.kind === "move") return `${A.name}（第${A.line}行）从 ${clsName(e.from)} 移动到 ${clsName(e.to)}`;
  const B = state.students[e.b];
  return `${A.name}（第${A.line}行，${clsName(e.from)}）与 ${B.name}（第${B.line}行，${clsName(e.to)}）对调`;
}
function renderLog() {
  $("adjust-log-box").classList.toggle("hidden", !state.adjustLog.length);
  $("adjust-log").innerHTML = state.adjustLog.map((e) => `<li>${esc(logText(e))}</li>`).join("");
}

/* 班主任抽签：按种子和抽签次数随机，结果可复现 */
$("btn-draw").onclick = () => {
  const names = $("teachers").value.split(/\n/).map((t) => t.trim()).filter(Boolean);
  if (names.length !== state.classCount) {
    toast(`班主任名单有 ${names.length} 人，班级有 ${state.classCount} 个，数量需要相同。请到「分班设置」填写。`, true);
    return;
  }
  const rng = FenbanAlgo.makeRng(state.seed * 31 + (++state.drawCount));
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  state.teachers = names;
  renderStats();
  toast(`第 ${state.drawCount} 次抽签完成`);
};

/* ---------- 调班弹窗 ---------- */
function scoreSummary(s) {
  if (!state.subjects.length) return "";
  const parts = state.subjects.map((sub) => `${esc(sub.key)} ${scoreCell(s.scores[sub.key])}`).join(" / ");
  return "，" + parts + (showTotal() ? `，总分 <strong>${totalCell(s)}</strong>` : "");
}

function openModal(idx) {
  const s = state.students[idx];
  const from = state.assignment[idx];
  state.modal = { idx, from, chosen: -1 };
  $("modal-title").textContent = `调班：${s.name}`;
  $("modal-student-info").innerHTML =
    `<span class="${s.gender === "男" ? "male" : "female"}">${s.gender}</span>，` +
    `现在 <strong>${esc(clsName(from))}</strong>${scoreSummary(s)}` +
    `<span class="muted">（原表第 ${s.line} 行）</span>`;
  const sel = $("modal-target");
  sel.innerHTML = "";
  for (let i = 0; i < state.classCount; i++) {
    if (i !== from) sel.add(new Option(clsName(i), i));
  }
  sel.onchange = refreshCandidates;
  document.querySelectorAll('input[name="swap-mode"]').forEach((r) => {
    r.checked = r.value === "swap";
    r.onchange = refreshCandidates;
  });
  refreshCandidates();
  $("overlay").classList.remove("hidden");
}

function refreshCandidates() {
  const mode = document.querySelector('input[name="swap-mode"]:checked').value;
  const target = parseInt($("modal-target").value, 10);
  const box = $("modal-candidates");
  $("modal-warn").classList.toggle("hidden", mode !== "move");
  if (mode === "move") { box.innerHTML = ""; state.modal.chosen = -1; return; }

  const cands = FenbanAlgo.swapCandidates(state.students, state.assignment, state.modal.idx, target).slice(0, 8);
  if (!cands.length) {
    box.innerHTML = `<div class="box warn">目标班没有同性别的学生可对调，只能选择「仅移动」。</div>`;
    state.modal.chosen = -1;
    return;
  }
  state.modal.chosen = cands[0].index;
  const hint = state.subjects.length ? "已按成绩水平接近程度排序，默认选第一个" : "同性别学生，默认选第一个";
  box.innerHTML = `<div class="muted" style="margin-bottom:4px">将从 ${esc(clsName(target))} 换出（${hint}）：</div>` +
    cands.map((c, i) => {
      const s = state.students[c.index];
      const total = showTotal() ? `，总分 ${totalCell(s)}` : "";
      const diff = c.totalDiff != null ? `总分相差 ${c.totalDiff}` : "";
      return `<label class="cand"><input type="radio" name="cand" value="${c.index}"${i === 0 ? " checked" : ""}>` +
        `${esc(s.name)}（${s.gender}${total}，原表第 ${s.line} 行）<span class="diff">${diff}</span></label>`;
    }).join("");
  box.querySelectorAll('input[name="cand"]').forEach((r) => {
    r.onchange = () => { state.modal.chosen = parseInt(r.value, 10); };
  });
}

const closeOverlay = (id) => $(id).classList.add("hidden");
$("modal-cancel").onclick = () => closeOverlay("overlay");
for (const id of ["overlay", "help"]) $(id).onclick = (e) => { if (e.target === $(id)) closeOverlay(id); };
$("modal-confirm").onclick = () => {
  const mode = document.querySelector('input[name="swap-mode"]:checked').value;
  if (mode === "swap") {
    if (state.modal.chosen < 0) { toast("没有可对调的学生，请改用「仅移动」。", true); return; }
    doSwap(state.modal.idx, state.modal.chosen);
  } else doMove(state.modal.idx, parseInt($("modal-target").value, 10));
  closeOverlay("overlay");
};

/* ---------- 第 5 步：导出 ---------- */
// Excel 工作表名不能含 \ / ? * [ ] : 且最长 31 字符
const sheetName = (t) => t.replace(/[\\\/?*\[\]:]/g, "").slice(0, 31);
// 原表若已有同名列，另起列名，避免覆盖原始数据
const freeLabel = (base) => (state.headers.includes(base) ? base + "(匀班)" : base);
const sorted = (c) => members(c).sort(SORTERS[$("sort-mode").value]);
const schoolName = () => $("school-name").value.trim();
// 只填了数字（如 2026）时补一个"年"字，其他写法（如 2026 学年、2026 年秋季）原样使用
const yearText = () => { const y = $("school-year").value.trim(); return /^\d+$/.test(y) ? y + "年" : y; };
const todayText = () => { const d = new Date(); return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`; };

$("btn-export").onclick = async () => {
  if (!canExport()) return;
  const wb = XLSX.utils.book_new();
  const N = state.classCount, t = state.teachers;
  const extra = (x, n) => ({
    ...(showTotal() ? { [freeLabel("总分")]: x.s.total == null ? "" : x.s.total } : {}),
    [freeLabel("班级")]: clsName(state.assignment[x.i]),
    [freeLabel("班内序号")]: n + 1,
  });

  const all = [], perClass = [];
  for (let c = 0; c < N; c++) {
    const rows = sorted(c).map((x, n) => ({ ...x.s.row, ...extra(x, n) }));
    perClass.push(rows);
    all.push(...rows);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all), "总名单");
  perClass.forEach((rows, c) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName(clsName(c))));

  const st = stats(), cols = avgColumns(st), r = st.ranges;
  const statRows = st.classes.map((k, i) => {
    const row = { "班级": clsName(i) };
    if (t) row["班主任"] = t[i];
    Object.assign(row, { "人数": k.count, "男": k.male, "女": k.female });
    cols.forEach((c) => { row[c.label] = num(c.cls(k)); });
    return row;
  });
  const rangeRow = { "班级": "班级间差距", "人数": r.count, "男": r.male, "女": r.female };
  cols.forEach((c) => { rangeRow[c.label] = num(c.rng); });
  statRows.push(rangeRow, {});
  const subjectDesc = state.subjects.length
    ? "均衡科目：" + state.subjects.map((s) => s.key + (s.weight !== 1 ? `(权重${s.weight})` : "")).join("、")
    : "无成绩模式";
  const catDesc = state.categories.length ? ` / 打散类别：${state.categories.join("、")}` : "";
  statRows.push({ "班级": "分班参数", "人数": `${gradeName()} / ${N}个班 / 种子${state.seed} / ${subjectDesc}${catDesc} / ${state.optimize ? "已" : "未"}开启均衡优化 / 均衡评分 ${balance(st, cols).score}` });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statRows), "均衡统计");

  const saved = await api("save", { kind: "export", ext: "xlsx", name: `分班结果-${gradeName()}`,
    data: XLSX.write(wb, { type: "base64", bookType: "xlsx" }) });
  toast(`已保存：${saved.name}`);
};

const PRINT_CSS = `
  body{font-family:"SimSun","宋体","Songti SC",serif;font-size:14pt;line-height:1.8;color:#000;
    max-width:800px;margin:0 auto;padding:30px 40px;}
  h1{text-align:center;font-family:"SimHei","黑体","Heiti SC",sans-serif;font-size:22pt;line-height:1.5;margin:0 0 20px;}
  h2{font-family:"SimHei","黑体","Heiti SC",sans-serif;font-size:16pt;margin:22px 0 10px;border-bottom:1px solid #000;padding-bottom:4px;}
  h3{font-family:"SimHei","黑体","Heiti SC",sans-serif;font-size:14pt;margin:16px 0 8px;}
  table{border-collapse:collapse;width:100%;font-size:10pt;margin:10px 0;line-height:1.5;}
  th,td{border:1px solid #000;padding:5px 4px;text-align:center;white-space:nowrap;}
  th{background:#f0f0f0;}
  tr.hl td{font-weight:bold;background:#f7f7f7;}
  .names{columns:5;column-gap:16px;font-size:12pt;padding-left:26px;margin:6px 0 14px;}
  .names li{break-inside:avoid;margin:2px 0;}
  .cls{break-inside:avoid-page;}
  .foot{margin-top:30px;text-align:right;line-height:2;}
  .tool{position:sticky;top:0;margin:-30px -40px 24px;background:#2C2C2A;color:#fff;padding:10px 16px;display:flex;gap:14px;
    align-items:center;font:13px "PingFang SC","Microsoft YaHei",sans-serif;}
  .tool button{font:inherit;background:#D85A30;color:#fff;border:0;border-radius:7px;padding:7px 16px;cursor:pointer;}
  @media print{ body{padding:0;max-width:none;} .tool{display:none;} @page{margin:2cm;} }`;

// 把排好版的页面交给外壳打印成 PDF 并打开；电脑上没有 Edge / Chrome 时得到的是网页文件，可在浏览器里打印
async function openDoc(title, body, css) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${esc(title)}</title>` +
    `<style>${css || PRINT_CSS}</style></head><body>${body}</body></html>`;
  toast("正在生成，请稍候……");
  const saved = await api("pdf", { name: title, html });
  toast(saved.kind === "pdf" ? `已保存：${saved.name}`
    : `这台电脑上没有找到 Edge 或 Chrome，已保存为网页文件：${saved.name}，打开后可以打印。`, saved.kind !== "pdf");
  api("open", { path: saved.path });
}

/* 各班名单：每班一页，只含姓名和性别，留出备注栏 */
$("btn-print-rosters").onclick = () => {
  if (!canExport()) return;
  const st = stats(), t = state.teachers;
  let body = TOOLBAR;
  for (let c = 0; c < state.classCount; c++) {
    const k = st.classes[c];
    body += `<section class="pg">${docHeader(gradeName() + " " + clsName(c) + " 学生名单")}` +
      `<p class="note"><b>共 ${k.count} 人</b>（男 ${k.male} 人，女 ${k.female} 人）${t ? `　<b>班主任：</b>${esc(t[c])}` : ""}</p>` +
      `<table ${fitRows(k.count + 1, 206, "margin-top:8px")}><tr><th style="width:10%">序号</th><th style="width:24%">姓名</th><th style="width:10%">性别</th><th>备注</th></tr>` +
      sorted(c).map((x, n) => `<tr><td>${n + 1}</td><td>${esc(x.s.name)}</td><td class="${x.s.gender === "男" ? "m" : "f"}">${x.s.gender}</td><td></td></tr>`).join("") +
      `</table>${docFooter(clsName(c))}</section>`;
  }
  openDoc(`${schoolName()}${yearText()}${gradeName()}各班名单`, body, REPORT_CSS);
};

/* 编班结果公示：只陈述方法、均衡数据和名单 */
$("btn-notice").onclick = () => {
  if (!canExport()) return;
  const N = state.classCount, subs = state.subjects, t = state.teachers;
  const withAvg = $("notice-avg").checked && subs.length > 0;
  const st = stats(), cols = withAvg ? avgColumns(st) : [], r = st.ranges;
  const title = `${schoolName()}${yearText()}${gradeName()}编班结果公示`;

  const subjectNames = subs.map((s) => esc(s.key)).join("、");
  let method = subs.length
    ? `本次编班以学生${subjectNames}${subs.length > 1 ? " " + subs.length + " 科" : ""}成绩和性别为均衡依据，采用计算机蛇形（S 形）编班方法` +
      (state.optimize ? `，并经同性别学生跨班对调优化` : "") + `。`
    : `本次编班不使用学生成绩，以性别为均衡依据，男、女生分别随机排序后依次编入各班。`;
  if (state.categories.length) method += `同时将同一${state.categories.map(esc).join("、")}的学生尽量平均分到各班。`;
  method += `随机种子号为 ${state.seed}。同一份名单、同样的编班设置和种子号，得到的结果相同。`;

  const extra = $("notice-cons").checked
    ? consSummary().map(([k, v]) => `<p>${k === "约束条件" ? "本次编班设置的约束条件" : "编班后的手动调整"}：${v}。</p>`).join("")
    : "";

  let statRows = st.classes.map((k, i) =>
    `<tr><td>${esc(clsName(i))}</td>${t ? `<td>${esc(t[i])}</td>` : ""}<td>${k.count}</td><td>${k.male}</td><td>${k.female}</td>` +
    cols.map((c) => `<td>${fmt(c.cls(k))}</td>`).join("") + `</tr>`).join("");
  statRows += `<tr class="hl"><td>班级间最大差距</td>${t ? "<td></td>" : ""}<td>${r.count}</td><td>${r.male}</td><td>${r.female}</td>` +
    cols.map((c) => `<td>${fmt(c.rng)}</td>`).join("") + `</tr>`;
  const subjRanges = cols.filter((c) => c.rng != null).map((c) => c.rng);
  const avgNote = subjRanges.length ? `，各项平均分最多相差 ${fmt(Math.max(...subjRanges))} 分` : "";

  let rosters = "";
  for (let c = 0; c < N; c++) {
    const k = st.classes[c];
    const names = members(c).sort(SORTERS.name).map((x) => x.s.name);
    rosters += `<div class="cls"><h3>${esc(clsName(c))}（共 ${k.count} 人：男 ${k.male} 人，女 ${k.female} 人）</h3><ol class="names">` +
      names.map((n) => `<li>${esc(n)}</li>`).join("") + `</ol></div>`;
  }

  openDoc(title, TOOLBAR + `<h1>${esc(schoolName())}${schoolName() ? "<br>" : ""}${esc(yearText() + gradeName())}编班结果公示</h1>
<h2>一、编班方法</h2>
<p>${method}</p>${extra}
<h2>二、各班情况</h2>
<table><tr><th>班级</th>${t ? "<th>班主任</th>" : ""}<th>人数</th><th>男生</th><th>女生</th>${cols.map((c) => `<th>${esc(c.label)}分</th>`).join("")}</tr>
${statRows}</table>
<p>${esc(gradeName())}共 ${state.students.length} 名学生，编入 ${N} 个班。各班人数最多相差 ${r.count} 人，男生人数最多相差 ${r.male} 人，女生人数最多相差 ${r.female} 人${avgNote}。</p>
<h2>三、各班学生名单</h2>
<p style="font-size:12pt">（名单按姓名排序）</p>
${rosters}
<div class="foot">${esc(schoolName())}<br>${todayText()}</div>`);
};

/* ---------- 分班报告（PDF 版式）：总览页 + 每班一页 ---------- */
const REPORT_CSS = `
  @page{size:A4;margin:14mm 14mm 16mm;}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:"PingFang SC","Microsoft YaHei","微软雅黑","Noto Sans CJK SC",sans-serif;color:#2C2C2A;background:#ECE8E1;margin:0;font-size:10.5pt;line-height:1.55;}
  .pg{background:#fff;width:210mm;min-height:297mm;margin:10mm auto;padding:14mm 14mm 12mm;break-after:page;}
  .pg:last-child{break-after:auto;}
  .hd{display:flex;align-items:center;gap:12px;border-bottom:2.5pt solid #993C1D;padding-bottom:9px;margin-bottom:14px;}
  .logo{width:38px;height:38px;border-radius:9px;background:#993C1D;color:#fff;font:700 21px/38px "Songti SC","SimSun",serif;text-align:center;flex:none;}
  .hd .t{font-size:19pt;font-weight:700;color:#712B13;line-height:1.2;}
  .hd .s{font-size:9.5pt;color:#6F6D68;}
  .hd .r{margin-left:auto;text-align:right;font-size:9pt;color:#6F6D68;line-height:1.5;}
  .tiles{display:flex;gap:10px;margin-bottom:14px;}
  .tile{flex:1;border:1px solid #E3DED6;border-radius:8px;padding:9px 12px;}
  .tile.key{border-color:#993C1D;background:#FAECE7;}
  .tile .k{font-size:9pt;color:#6F6D68;}
  .tile .v{font-size:21pt;font-weight:700;color:#712B13;line-height:1.25;}
  .tile .v small{font-size:10pt;font-weight:500;color:#6F6D68;margin-left:2px;}
  h3{font-size:11.5pt;color:#712B13;margin:14px 0 7px;padding-left:8px;border-left:3.5pt solid #993C1D;line-height:1.2;}
  table{border-collapse:collapse;width:100%;font-size:9.5pt;}
  th{background:#FAECE7;color:#712B13;font-weight:600;padding:5px 4px;border:1px solid #E6CFC5;}
  td{padding:3.5px 4px;border:1px solid #E3DED6;text-align:center;}
  tr.hl td{background:#FBF4E4;font-weight:600;}
  tr:nth-child(even) td{background:#FBFAF8;} tr.hl:nth-child(even) td{background:#FBF4E4;}
  .m{color:#185FA5;} .f{color:#993556;}
  .charts{display:flex;gap:16px;} .charts>div{flex:1;min-width:0;}
  .note{font-size:9.5pt;color:#55534F;line-height:1.75;margin:0;}
  .note b{color:#2C2C2A;}
  .two{display:flex;gap:12px;align-items:flex-start;} .two table{flex:1;}
  .fit th,.fit td{height:var(--rh);padding:0 4px;line-height:1.05;}
  .ft{margin-top:12px;border-top:1px solid #E3DED6;padding-top:5px;font-size:8.5pt;color:#8A8780;display:flex;justify-content:space-between;}
  .tool{position:sticky;top:0;background:#2C2C2A;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center;font-size:13px;z-index:9;}
  .tool button{font:inherit;background:#D85A30;color:#fff;border:0;border-radius:7px;padding:7px 16px;cursor:pointer;}
  @media print{ body{background:#fff;} .pg{margin:0;padding:0;width:auto;min-height:0;} .tool{display:none;} }`;

// 让 rows 行的表格排进 avail 毫米：返回写在 <table> 上的行高和字号（行高限制在 4.3～7.5 毫米）
function fitRows(rows, avail, extra) {
  const h = Math.max(4.3, Math.min(7.5, avail / rows));
  return `class="fit" style="--rh:${h.toFixed(2)}mm;font-size:${Math.min(10.5, h * 1.75).toFixed(1)}pt;${extra || ""}"`;
}

// 只在退回成网页文件时用得上；生成 PDF 时不会印出来
const TOOLBAR = `<div class="tool"><button onclick="window.print()">打印</button></div>`;

// 竖向柱状图。groups: [{label, parts:[{v, color}], text}]，parts 叠放
function svgBars(groups, w, h) {
  const L = 8, R = 8, T = 18, B = 22, pw = w - L - R, ph = h - T - B;
  const vmax = Math.max(1e-9, ...groups.map((g) => g.parts.reduce((t, p) => t + p.v, 0))) * 1.12;
  const gw = pw / groups.length, bw = Math.min(34, gw * 0.62), fs = groups.length > 12 ? 7.5 : 9;
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="PingFang SC,Microsoft YaHei,sans-serif">`;
  groups.forEach((g, i) => {
    const x = L + gw * i + (gw - bw) / 2;
    let y = T + ph;
    g.parts.forEach((p) => {
      const bh = ph * p.v / vmax;
      y -= bh;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${p.color}"/>`;
    });
    s += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="#55534F">${esc(g.text)}</text>` +
      `<text x="${(x + bw / 2).toFixed(1)}" y="${h - 7}" text-anchor="middle" font-size="${fs}" fill="#2C2C2A">${esc(g.label)}</text>`;
  });
  return s + `<line x1="${L}" x2="${w - R}" y1="${T + ph}" y2="${T + ph}" stroke="#B4B2A9"/></svg>`;
}

// 报告和名单共用的页眉、页脚
function docHeader(title) {
  const sub = [schoolName(), yearText()].filter(Boolean).join(" · ");
  return `<div class="hd"><div class="logo">匀</div><div><div class="t">${esc(title)}</div>` +
    `<div class="s">${esc(sub)}</div></div><div class="r">生成日期<br>${todayText()}</div></div>`;
}
const docFooter = (text) => `<div class="ft"><span>匀班 · 学生均衡分班工具</span><span>${esc(text)}</span></div>`;

// 约束与手动调整的数量说明（公示和报告共用）；没有则返回空数组
function consSummary() {
  const res = resolveConstraints(), out = [];
  const of = (type) => res.filter((c) => c.type === type);
  const parts = [];
  if (of("together").length) parts.push(`必须同班 ${of("together").length} 组`);
  if (of("apart").length) parts.push(`必须分开 ${of("apart").length} 组`);
  const locked = of("lock").reduce((n, c) => n + c.members.length, 0);
  if (locked) parts.push(`指定班级 ${locked} 人`);
  if (parts.length) out.push(["约束条件", parts.join("，")]);
  const swaps = state.adjustLog.filter((e) => e.kind === "swap").length, moves = state.adjustLog.length - swaps;
  const adj = [];
  if (swaps) adj.push(`对调 ${swaps} 处`);
  if (moves) adj.push(`单向移动 ${moves} 处`);
  if (adj.length) out.push(["手动调整", adj.join("，")]);
  return out;
}

$("btn-report").onclick = () => {
  if (!canExport()) return;
  const N = state.classCount, subs = state.subjects, t = state.teachers;
  const st = stats(), cols = avgColumns(st), r = st.ranges, bal = balance(st, cols);
  const withScores = $("report-scores").checked && subs.length > 0;
  const short = (i) => (N > 10 ? String(i + 1) : clsName(i));
  const header = docHeader, footer = docFooter;

  // 总览页
  const ranges = cols.filter((c) => c.rng != null).map((c) => c.rng);
  const tiles = [
    ["学生总数", state.students.length, "人", ""],
    ["班级数量", N, "个", ""],
    ["均衡评分", bal.score, "分", " key"],
    ranges.length ? ["各项平均分最大差距", fmt(Math.max(...ranges)), "分", ""] : ["班级人数最大差距", r.count, "人", ""],
  ].map(([k, v, u, cls]) => `<div class="tile${cls}"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`).join("");

  let table = `<table><tr><th>班级</th>${t ? "<th>班主任</th>" : ""}<th>人数</th><th>男</th><th>女</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>` +
    st.classes.map((k, i) => `<tr><td>${esc(clsName(i))}</td>${t ? `<td>${esc(t[i])}</td>` : ""}<td>${k.count}</td><td>${k.male}</td><td>${k.female}</td>` +
      cols.map((c) => `<td>${fmt(c.cls(k))}</td>`).join("") + `</tr>`).join("") +
    `<tr class="hl"><td>班级间差距</td>${t ? "<td></td>" : ""}<td>${r.count}</td><td>${r.male}</td><td>${r.female}</td>` +
    cols.map((c) => `<td>${fmt(c.rng)}</td>`).join("") + `</tr></table>`;

  const genderChart = svgBars(st.classes.map((k, i) => ({ label: short(i), text: `${k.male}/${k.female}`,
    parts: [{ v: k.male, color: "#6E93BD" }, { v: k.female, color: "#D59AAC" }] })), 340, 170);
  const main = cols[cols.length - 1]; // 多科时是总分平均，单科时是该科平均
  const avgChart = main ? svgBars(st.classes.map((k, i) => ({ label: short(i), text: fmt(main.cls(k)),
    parts: [{ v: main.cls(k) || 0, color: "#993C1D" }] })), 340, 170) : "";

  const info = [
    ["均衡依据", subs.length ? subs.map((s) => s.key + (s.weight !== 1 ? `（权重 ${s.weight}）` : "")).join("、") + "、性别" : "性别（无成绩模式）"],
  ];
  if (state.categories.length) info.push(["打散类别", state.categories.join("、")]);
  info.push(["分班方法", subs.length ? "蛇形分班" + (state.optimize ? " + 均衡优化" : "") : "男、女生分别随机排序后依次编入各班"]);
  info.push(["随机种子", String(state.seed)]);
  const lacking = state.students.filter((s) => s.missing.length).length;
  if (lacking) info.push(["缺成绩学生", `${lacking} 人，所缺科目不计入均衡`]);
  if ($("notice-cons").checked) info.push(...consSummary());

  let body = TOOLBAR + `<section class="pg">${header(gradeName() + "分班报告")}<div class="tiles">${tiles}</div>` +
    `<h3>各班情况</h3>${table}` +
    `<div class="charts"><div><h3>各班人数（男 / 女）</h3>${genderChart}</div>` +
    (avgChart ? `<div><h3>各班${esc(main.label)}分</h3>${avgChart}</div>` : "") + `</div>` +
    `<h3>分班设置</h3><p class="note">${info.map(([k, v]) => `<b>${k}：</b>${esc(v)}`).join("<br>")}</p>` +
    footer("总览") + `</section>`;

  // 每班一页
  for (let c = 0; c < N; c++) {
    const k = st.classes[c], list = sorted(c);
    const ctiles = [["人数", k.count, "人"], ["男生", k.male, "人"], ["女生", k.female, "人"]]
      .concat(main ? [[main.label, fmt(main.cls(k)), "分"]] : [])
      .map(([a, v, u]) => `<div class="tile"><div class="k">${esc(a)}</div><div class="v">${v}<small>${u}</small></div></div>`).join("");
    const g = (s) => `<td class="${s.gender === "男" ? "m" : "f"}">${s.gender}</td>`;
    let roster;
    if (withScores) {
      roster = `<table ${fitRows(list.length + 1, 198)}><tr><th>序号</th><th>姓名</th><th>性别</th>${subs.map((s) => `<th>${esc(s.key)}</th>`).join("")}${showTotal() ? "<th>总分</th>" : ""}</tr>` +
        list.map((x, n) => `<tr><td>${n + 1}</td><td>${esc(x.s.name)}</td>${g(x.s)}` +
          subs.map((s) => `<td>${scoreCell(x.s.scores[s.key])}</td>`).join("") +
          (showTotal() ? `<td><b>${totalCell(x.s)}</b></td>` : "") + `</tr>`).join("") + `</table>`;
    } else {
      const half = Math.ceil(list.length / 2);
      const part = (from, to) => `<table ${fitRows(half + 1, 210)}><tr><th>序号</th><th>姓名</th><th>性别</th></tr>` +
        list.slice(from, to).map((x, n) => `<tr><td>${from + n + 1}</td><td>${esc(x.s.name)}</td>${g(x.s)}</tr>`).join("") + `</table>`;
      roster = `<div class="two">${part(0, half)}${part(half, list.length)}</div>`;
    }
    body += `<section class="pg">${header(clsName(c) + (t ? `　班主任：${t[c]}` : ""))}<div class="tiles">${ctiles}</div>` +
      `<h3>学生名单</h3>${roster}${footer(clsName(c))}</section>`;
  }
  openDoc(`${schoolName()}${yearText()}${gradeName()}分班报告`, body, REPORT_CSS);
};

/* ---------- 试用与激活（正式安装包才有；用源码运行时 state 为 open，不显示也不限制） ---------- */
async function refreshLicense() {
  const st = await api("state");
  license = st.license;
  $("out-folder").textContent = st.output;
  renderLicense();
}
function renderLicense() {
  const lic = license, btn = $("btn-license");
  btn.classList.toggle("hidden", lic.state === "open");
  btn.textContent = lic.state === "active" ? "已激活"
    : lic.state === "trial" ? `试用中 · 剩 ${lic.daysLeft} 天` : "试用已结束 · 输入激活码";
  btn.classList.toggle("primary", lic.state === "expired");
  $("lic-state").innerHTML = lic.state === "active"
    ? `<span class="pill ok">已激活</span> ${lic.expiry ? "有效期至 " + esc(lic.expiry) : "长期有效"}`
    : lic.state === "trial"
      ? `<span class="pill warn">试用中</span> 还可以免费使用 ${lic.daysLeft} 天，试用期内功能不受限制。`
      : `<span class="pill bad">试用已结束</span> 仍然可以分班和查看结果，导出需要先激活。`;
  $("lic-machine").textContent = lic.machine || "";
  $("lic-contact").textContent = lic.contact || "";
}
function openLicense() { renderLicense(); $("license").classList.remove("hidden"); }
// 界面上先拦一道，省得白等；真正的检查在外壳程序里
function canExport() {
  if (license.canExport) return true;
  openLicense();
  toast("试用已结束，导出需要先激活。", true);
  return false;
}
$("btn-license").onclick = openLicense;
$("lic-close").onclick = () => closeOverlay("license");
$("license").onclick = (e) => { if (e.target === $("license")) closeOverlay("license"); };
$("lic-copy").onclick = () => {
  const text = $("lic-machine").textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("机器码已复制"), () => toast("复制失败，请手动选中机器码复制。", true));
  else toast("请手动选中机器码复制。", true);
};
$("lic-activate").onclick = async () => {
  const code = $("lic-code").value.trim();
  if (!code) { toast("请先粘贴激活码。", true); return; }
  const lic = await api("activate", { code });
  if (!lic.activated) { toast(lic.message || "激活码无效。", true); return; }
  license = lic;
  renderLicense();
  $("lic-code").value = "";
  closeOverlay("license");
  toast("激活成功");
};
$("btn-reveal").onclick = () => api("reveal");
refreshLicense();
setInterval(() => api("ping").catch(() => {}), 5000); // 用浏览器显示界面时，外壳靠它知道页面还开着

/* ---------- 方案文件：保存与载入 ---------- */
$("btn-save-plan").onclick = async () => {
  const L = (i) => state.students[i].line;
  const plan = {
    app: "yunban", version: 2, savedAt: new Date().toISOString(),
    fileName: state.fileName, headers: state.headers, rows: state.rows, lines: state.lines,
    mapping: state.mapping, subjectCols: state.subjectCols, catCols: state.catCols,
    settings: {
      grade: $("grade").value, classTpl: $("class-tpl").value, classCount: state.classCount,
      seed: state.seed, optimize: state.optimize, teachersText: $("teachers").value,
      school: $("school-name").value, year: $("school-year").value, sortMode: $("sort-mode").value,
    },
    constraints: state.constraints,
    assignment: state.students.map((s, i) => ({ line: s.line, cls: state.assignment[i] })),
    adjustLog: state.adjustLog.map((e) => ({ ...e, a: L(e.a), b: e.b == null ? null : L(e.b) })),
    teachers: state.teachers, drawCount: state.drawCount,
  };
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const saved = await api("save", { kind: "plan", ext: "json", name: `匀班方案-${gradeName()}-${stamp}`, data: btoa(bin) });
  toast(`方案已保存：${saved.name}`);
};

$("btn-load-plan").onclick = () => $("plan-input").click();
$("plan-input").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let plan;
    try { plan = JSON.parse(reader.result); } catch (err) { plan = null; }
    if (!plan || plan.app !== "yunban" || !Array.isArray(plan.rows)) { toast("这不是匀班的方案文件。", true); return; }
    loadPlan(plan);
  };
  reader.readAsText(file);
};

function loadPlan(plan) {
  const s = plan.settings || {};
  Object.assign(state, {
    wb: null, fileName: plan.fileName || "", headers: plan.headers, rows: plan.rows, lines: plan.lines,
    mapping: plan.mapping, subjectCols: plan.subjectCols || [], catCols: plan.catCols || [],
    constraints: plan.constraints || [], pending: [], maxStep: 1,
  });
  $("grade").value = s.grade || ""; $("class-tpl").value = s.classTpl || "{n}班";
  $("class-count").value = s.classCount || 8; $("seed").value = s.seed || "";
  $("opt-optimize").checked = s.optimize !== false; $("teachers").value = s.teachersText || "";
  $("school-name").value = s.school || ""; $("school-year").value = s.year || "";
  $("sort-mode").value = s.sortMode || "name";
  renderImport();
  revalidate();

  const idx = byLine();
  const saved = new Map((plan.assignment || []).map((x) => [x.line, x.cls]));
  if (state.students.length >= 2 && state.students.every((st) => saved.has(st.line))) {
    Object.assign(state, {
      classCount: s.classCount, seed: s.seed, optimize: s.optimize !== false,
      assignment: state.students.map((st) => saved.get(st.line)),
      adjustLog: (plan.adjustLog || []).map((e) => ({ ...e, a: idx.get(e.a), b: e.b == null ? undefined : idx.get(e.b) })),
      teachers: plan.teachers || null, drawCount: plan.drawCount || 0, currentClass: 0,
    });
    state.maxStep = 5;
    goto(4);
  } else goto(state.students.length >= 2 ? 2 : 1);
  toast("方案已载入");
}

/* ---------- 顶栏：帮助、大屏、深浅色 ---------- */
$("btn-help").onclick = () => $("help").classList.remove("hidden");
$("help-close").onclick = () => closeOverlay("help");
$("btn-big").onclick = () => {
  const on = document.body.classList.toggle("big");
  $("btn-big").textContent = on ? "退出大屏" : "大屏";
};
function currentTheme() {
  return document.documentElement.dataset.theme ||
    (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  $("btn-theme").textContent = t === "dark" ? "浅色" : "深色";
  try { localStorage.setItem("yunban-theme", t); } catch (err) { /* 无痕模式等场景下存不了，忽略 */ }
}
$("btn-theme").onclick = () => setTheme(currentTheme() === "dark" ? "light" : "dark");
try { const saved = localStorage.getItem("yunban-theme"); if (saved) document.documentElement.dataset.theme = saved; } catch (err) { /* 同上 */ }
$("btn-theme").textContent = currentTheme() === "dark" ? "浅色" : "深色";

renderSteps();
