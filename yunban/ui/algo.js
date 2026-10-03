/* 分班核心算法：性别分组蛇形分班 + 同性别交换优化
 * 浏览器下挂载为 window.FenbanAlgo，Node 下作为 CommonJS 模块（供测试脚本用）
 *
 * 学生: {gender:'男'|'女', scores:{科目key: 数字|null}, cats:{类别key: 文本}}，缺成绩用 null
 * 科目: [{key, weight}]，weight 缺省为 1；空数组即「无成绩模式」（仅按性别随机均衡）
 * 类别: [key]，需要在各班之间打散的类别字段（如毕业学校）
 * 约束: [{type:'together'|'apart'|'lock', members:[学生下标], cls:班级下标(仅 lock)}]
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FenbanAlgo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // mulberry32 可复现伪随机数
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function has(v) { return typeof v === "number" && isFinite(v); }
  function weightOf(sub) { return sub.weight == null ? 1 : sub.weight; }

  // 一组值（可含缺失）的均值与标准差
  function meanSd(n, get) {
    var cnt = 0, sum = 0, sq = 0;
    for (var i = 0; i < n; i++) {
      var v = get(i);
      if (has(v)) { cnt++; sum += v; sq += v * v; }
    }
    var mean = cnt ? sum / cnt : 0;
    return { mean: mean, sd: cnt ? Math.sqrt(Math.max(0, sq / cnt - mean * mean)) : 0 };
  }

  /* 为每个学生补上派生字段（可重复调用）:
   *   total     已有成绩之和（一科都没有则为 null）
   *   complete  是否所有科目都有成绩
   *   composite 综合水平 = 已有科目标准分的加权平均；没有任何成绩记 0，即视为年级平均水平
   * 用标准分而不是原始分，是为了让满分不同的科目（如 150 分与 100 分）权重对等。
   */
  function prepare(students, subjects) {
    subjects = subjects || [];
    var st = subjects.map(function (sub) {
      return meanSd(students.length, function (i) { return (students[i].scores || {})[sub.key]; });
    });
    students.forEach(function (s) {
      var sc = s.scores || {}, total = 0, cnt = 0, z = 0, w = 0;
      subjects.forEach(function (sub, k) {
        var v = sc[sub.key];
        if (!has(v)) return;
        total += v; cnt++;
        if (st[k].sd > 0) { z += weightOf(sub) * (v - st[k].mean) / st[k].sd; w += weightOf(sub); }
      });
      s.total = cnt ? Math.round(total * 100) / 100 : null;
      s.complete = cnt === subjects.length;
      s.composite = w > 0 ? z / w : 0;
    });
    return students;
  }

  /* 整理并校验约束，互相矛盾时抛出 Error（message 为可直接展示的中文）。
   * 返回 {lockOf: 学生->指定班级(-1 无), unions: 必须同班的学生组, apart: 必须分开的学生组} */
  function normalizeConstraints(constraints, n, N) {
    var parent = [], i;
    for (i = 0; i < n; i++) parent.push(i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    var lockOf = new Array(n).fill(-1), apart = [];

    (constraints || []).forEach(function (c) {
      if (c.type === "together") {
        for (var k = 1; k < c.members.length; k++) parent[find(c.members[k])] = find(c.members[0]);
      }
    });
    (constraints || []).forEach(function (c) {
      if (c.type !== "lock") return;
      if (!(c.cls >= 0 && c.cls < N)) throw new Error("「指定班级」约束中的班级超出了当前班级数量。");
      c.members.forEach(function (m) {
        var r = find(m);
        if (lockOf[r] !== -1 && lockOf[r] !== c.cls) throw new Error("约束冲突：同一名学生（或要求同班的一组学生）被指定到了不同的班级。");
        lockOf[r] = c.cls;
      });
    });
    (constraints || []).forEach(function (c) {
      if (c.type !== "apart") return;
      if (c.members.length > N) throw new Error("约束冲突：要求分开的一组有 " + c.members.length + " 人，超过了班级数量 " + N + "。");
      var roots = {}, classes = {};
      c.members.forEach(function (m) {
        var r = find(m);
        if (roots[r]) throw new Error("约束冲突：同一批学生既被要求同班，又被要求分开。");
        roots[r] = true;
        if (lockOf[r] !== -1) {
          if (classes[lockOf[r]]) throw new Error("约束冲突：要求分开的学生被指定到了同一个班。");
          classes[lockOf[r]] = true;
        }
      });
      apart.push(c.members.slice());
    });

    var byRoot = {}, unions = [];
    for (i = 0; i < n; i++) {
      var r = find(i);
      if (r !== i || lockOf[r] !== -1) (byRoot[r] = byRoot[r] || [r]);
      if (r !== i) byRoot[r].push(i);
    }
    Object.keys(byRoot).forEach(function (r) { unions.push({ members: byRoot[r], cls: lockOf[r] }); });
    return { unions: unions, apart: apart };
  }

  /* 在蛇形结果上落实约束：尽量用「同性别、水平最接近」的学生对调，保持均衡。
   * 返回优化阶段需要的上下文：pinned(不可再动的学生)、groupsOf/groups(分开约束) */
  function applyConstraints(students, assignment, N, cons) {
    var n = students.length;
    var pinned = new Uint8Array(n), groupsOf = new Array(n), groups = cons.apart;
    groups.forEach(function (g, gi) {
      g.forEach(function (m) { (groupsOf[m] = groupsOf[m] || []).push(gi); });
    });
    cons.unions.forEach(function (u) { u.members.forEach(function (m) { pinned[m] = 1; }); });

    // i 进入 cls 班后，是否仍与它所有「分开」组的其他成员不同班（ignore 为正与它对调的学生）
    function apartOK(i, cls, ignore) {
      var gs = groupsOf[i];
      if (!gs) return true;
      for (var a = 0; a < gs.length; a++) {
        var g = groups[gs[a]];
        for (var b = 0; b < g.length; b++) {
          if (g[b] !== i && g[b] !== ignore && assignment[g[b]] === cls) return false;
        }
      }
      return true;
    }

    // 把 i 放进 target 班：优先与该班同性别、水平最接近的学生对调；找不到再放宽到异性；仍找不到则直接移动
    function place(i, target) {
      var from = assignment[i];
      if (from === target) return;
      var best = -1, bestDiff = Infinity, pass, j;
      for (pass = 0; pass < 2 && best < 0; pass++) {
        for (j = 0; j < n; j++) {
          if (assignment[j] !== target || pinned[j]) continue;
          if (pass === 0 && students[j].gender !== students[i].gender) continue;
          if (!apartOK(j, from, i)) continue;
          var d = Math.abs(students[j].composite - students[i].composite);
          if (d < bestDiff) { bestDiff = d; best = j; }
        }
      }
      assignment[i] = target;
      if (best >= 0) assignment[best] = from;
    }

    // 同班组 / 指定班级：未指定班级时，取组内成员当前最集中的班
    cons.unions.forEach(function (u) {
      var target = u.cls;
      if (target === -1) {
        var votes = new Array(N).fill(0);
        u.members.forEach(function (m) { votes[assignment[m]]++; });
        target = votes.indexOf(Math.max.apply(null, votes));
      }
      u.members.forEach(function (m) { place(m, target); });
    });

    // 分开组：同班的成员中留一个，其余换到没有本组成员的班
    groups.forEach(function (g) {
      var seen = {};
      // 已固定的成员先占位
      g.forEach(function (m) { if (pinned[m]) seen[assignment[m]] = true; });
      g.forEach(function (m) {
        if (pinned[m]) return;
        var c = assignment[m];
        if (!seen[c]) { seen[c] = true; return; }
        for (var t = 0; t < N; t++) {
          if (!seen[t] && apartOK(m, t, -1)) { place(m, t); seen[t] = true; return; }
        }
      });
    });

    return { pinned: pinned, groupsOf: groupsOf, apartOK: apartOK };
  }

  /* 检查分班结果是否满足约束，返回未满足的约束在 constraints 中的下标 */
  function checkConstraints(assignment, constraints) {
    var bad = [];
    (constraints || []).forEach(function (c, ci) {
      var cls = c.members.map(function (m) { return assignment[m]; }), ok = true;
      if (c.type === "lock") ok = cls.every(function (x) { return x === c.cls; });
      else if (c.type === "together") ok = cls.every(function (x) { return x === cls[0]; });
      else if (c.type === "apart") ok = cls.every(function (x, k) { return cls.indexOf(x) === k; });
      if (!ok) bad.push(ci);
    });
    return bad;
  }

  /* 返回 assignment: 每个学生的班级下标 (0..classCount-1)
   * opts: {subjects, categories, constraints, seed, optimize, iterations}
   */
  function assign(students, classCount, opts) {
    opts = opts || {};
    var subjects = opts.subjects || [];
    var rng = makeRng(opts.seed == null ? 42 : opts.seed);
    var N = classCount;
    prepare(students, subjects);

    // 男女分开，先随机打乱（同分公平），再按综合水平降序稳定排序
    var byGender = { "男": [], "女": [] };
    students.forEach(function (s, i) { byGender[s.gender].push(i); });
    Object.keys(byGender).forEach(function (g) {
      shuffle(byGender[g], rng);
      byGender[g].sort(function (a, b) { return students[b].composite - students[a].composite; });
    });

    var assignment = new Array(students.length);

    // 蛇形发牌；mirror 时班号左右镜像
    function deal(list, mirror) {
      for (var k = 0; k < list.length; k++) {
        var round = Math.floor(k / N), pos = k % N;
        var cls = (round % 2 === 0) ? pos : N - 1 - pos;
        if (mirror) cls = N - 1 - cls;
        assignment[list[k]] = cls;
      }
    }
    // 不能整除时，零头落在最后一轮的起始端（偶数轮在低班号端，奇数轮在高班号端）。
    // 让女生的零头落在与男生相反的一端，班级总人数差才能保证 ≤1。
    var lowEnd = function (list) { return Math.floor(list.length / N) % 2 === 0; };
    deal(byGender["男"], false);
    deal(byGender["女"], lowEnd(byGender["男"]) === lowEnd(byGender["女"]));

    var categories = opts.categories || [];
    var ctx = applyConstraints(students, assignment, N, normalizeConstraints(opts.constraints, students.length, N));

    if (opts.optimize !== false && (subjects.length || categories.length)) {
      var iterations = opts.iterations || Math.min(400000, Math.max(40000, students.length * 100));
      optimize(students, assignment, N, rng, iterations, subjects, categories, ctx);
    }
    return assignment;
  }

  /* 同性别跨班交换优化：目标 = Σ_班 Σ_维度 权重 × ((班均分 - 全体均分) / 标准差)²，只降不升。
   * 维度 = 各科目 + 总分（仅统计成绩齐全的学生）+ 类别字段的每个取值（是/否，使各班占比接近全体占比）。
   * 缺成绩的学生不计入该维度的班均分。交换不改变班级人数与性别构成，也不会破坏约束。 */
  function optimize(students, assignment, N, rng, iterations, subjects, categories, ctx) {
    var n = students.length, i, d;

    var getters = [];
    subjects.forEach(function (sub) {
      if (weightOf(sub) > 0) getters.push({ w: weightOf(sub), get: function (s) { return s.scores[sub.key]; } });
    });
    if (subjects.length > 1) getters.push({ w: 1, get: function (s) { return s.complete ? s.total : null; } });
    // 类别取值按人数占比加权，一个类别字段的总权重为 1；取值过多（如误选了姓名列）则忽略
    categories.forEach(function (key) {
      var counts = {};
      students.forEach(function (s) { var v = (s.cats || {})[key]; if (v) counts[v] = (counts[v] || 0) + 1; });
      var values = Object.keys(counts);
      if (values.length > 60) return;
      values.forEach(function (v) {
        if (counts[v] < 2) return;
        getters.push({ w: counts[v] / n, get: function (s) { return (s.cats || {})[key] === v ? 1 : 0; } });
      });
    });

    // 每个维度：学生取值、是否有值、全体均值（交换不改变，作为基准）、标准差
    var dims = [];
    getters.forEach(function (g) {
      var val = new Float64Array(n), ok = new Uint8Array(n);
      for (i = 0; i < n; i++) {
        var v = g.get(students[i]);
        if (has(v)) { val[i] = v; ok[i] = 1; }
      }
      var ms = meanSd(n, function (k) { return ok[k] ? val[k] : null; });
      if (ms.sd > 0) dims.push({ w: g.w, val: val, ok: ok, mean: ms.mean, sd: ms.sd,
        sum: new Float64Array(N), cnt: new Float64Array(N) });
    });
    if (!dims.length) return;

    for (i = 0; i < n; i++) {
      for (d = 0; d < dims.length; d++) {
        dims[d].sum[assignment[i]] += dims[d].val[i];
        dims[d].cnt[assignment[i]] += dims[d].ok[i];
      }
    }
    var genderIdx = { "男": [], "女": [] };
    for (i = 0; i < n; i++) genderIdx[students[i].gender].push(i);

    function classTerm(c) {
      var t = 0;
      for (var k = 0; k < dims.length; k++) {
        var D = dims[k];
        if (!D.cnt[c]) continue;
        var z = (D.sum[c] / D.cnt[c] - D.mean) / D.sd;
        t += D.w * z * z;
      }
      return t;
    }

    // 把 a(在 ca 班) 与 b(在 cb 班) 对调计入各班累计；sign=-1 为回滚
    function applySwap(a, b, ca, cb, sign) {
      for (var k = 0; k < dims.length; k++) {
        var D = dims[k];
        var dv = sign * (D.val[a] - D.val[b]), dc = sign * (D.ok[a] - D.ok[b]);
        D.sum[ca] -= dv; D.sum[cb] += dv;
        D.cnt[ca] -= dc; D.cnt[cb] += dc;
      }
    }

    for (var it = 0; it < iterations; it++) {
      var pool = genderIdx[rng() < 0.5 ? "男" : "女"];
      if (pool.length < 2) pool = genderIdx[pool === genderIdx["男"] ? "女" : "男"];
      var a = pool[Math.floor(rng() * pool.length)];
      var b = pool[Math.floor(rng() * pool.length)];
      var ca = assignment[a], cb = assignment[b];
      if (ca === cb || ctx.pinned[a] || ctx.pinned[b]) continue;
      if ((ctx.groupsOf[a] || ctx.groupsOf[b]) && !(ctx.apartOK(a, cb, b) && ctx.apartOK(b, ca, a))) continue;

      var before = classTerm(ca) + classTerm(cb);
      applySwap(a, b, ca, cb, 1);
      if (classTerm(ca) + classTerm(cb) < before - 1e-12) {
        assignment[a] = cb; assignment[b] = ca; // 采纳
      } else {
        applySwap(a, b, ca, cb, -1); // 回滚
      }
    }
  }

  /* 均衡度统计：每班人数/性别/各科平均分，以及各指标的班级间极差。
   * 需先 prepare。某班某科无人有成绩时平均分为 null；总分平均只统计成绩齐全的学生。 */
  function computeStats(students, assignment, N, subjects) {
    subjects = subjects || [];
    var classes = [], c;
    for (c = 0; c < N; c++) {
      classes.push({ count: 0, male: 0, female: 0, sum: {}, n: {}, avg: {}, sumTotal: 0, nTotal: 0, avgTotal: null });
      subjects.forEach(function (sub) { classes[c].sum[sub.key] = 0; classes[c].n[sub.key] = 0; });
    }
    students.forEach(function (s, i) {
      var k = classes[assignment[i]];
      k.count++;
      if (s.gender === "男") k.male++; else k.female++;
      subjects.forEach(function (sub) {
        var v = s.scores[sub.key];
        if (has(v)) { k.sum[sub.key] += v; k.n[sub.key]++; }
      });
      if (subjects.length && s.complete) { k.sumTotal += s.total; k.nTotal++; }
    });
    classes.forEach(function (k) {
      subjects.forEach(function (sub) { k.avg[sub.key] = k.n[sub.key] ? k.sum[sub.key] / k.n[sub.key] : null; });
      k.avgTotal = k.nTotal ? k.sumTotal / k.nTotal : null;
    });
    function range(get) {
      var vs = classes.map(get).filter(has);
      return vs.length ? Math.max.apply(null, vs) - Math.min.apply(null, vs) : null;
    }
    var ranges = {
      count: range(function (k) { return k.count; }),
      male: range(function (k) { return k.male; }),
      female: range(function (k) { return k.female; }),
      avg: {},
      avgTotal: range(function (k) { return k.avgTotal; }),
    };
    subjects.forEach(function (sub) {
      ranges.avg[sub.key] = range(function (k) { return k.avg[sub.key]; });
    });
    return { classes: classes, ranges: ranges };
  }

  /* 对调候选：目标班中与 idx 同性别的学生，按综合水平接近程度排序（"相同位置"的学生优先）。
   * totalDiff 为总分差，任一方缺成绩时为 null。需先 prepare。 */
  function swapCandidates(students, assignment, idx, targetClass) {
    var me = students[idx], out = [];
    students.forEach(function (s, i) {
      if (i !== idx && assignment[i] === targetClass && s.gender === me.gender) {
        out.push({
          index: i,
          diff: Math.abs(s.composite - me.composite),
          totalDiff: (s.complete && me.complete && has(s.total) && has(me.total))
            ? Math.round(Math.abs(s.total - me.total) * 100) / 100 : null,
        });
      }
    });
    out.sort(function (a, b) { return a.diff - b.diff; });
    return out;
  }

  return {
    makeRng: makeRng,
    prepare: prepare,
    assign: assign,
    computeStats: computeStats,
    checkConstraints: checkConstraints,
    swapCandidates: swapCandidates,
  };
});
