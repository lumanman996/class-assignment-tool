/* 分班核心算法：性别分组蛇形分班 + 同性别交换优化
 * 浏览器下挂载为 window.FenbanAlgo，Node 下作为 CommonJS 模块（供测试脚本用）
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FenbanAlgo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SUBJECTS = ["chinese", "math", "english", "total"];

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

  /* students: [{gender:'男'|'女', chinese, math, english, total}]
   * 返回 assignment: 每个学生的班级下标 (0..classCount-1)
   */
  function assign(students, classCount, opts) {
    opts = opts || {};
    var rng = makeRng(opts.seed == null ? 42 : opts.seed);
    var N = classCount;

    // 男女分开，先随机打乱（同分公平），再按总分降序稳定排序
    var byGender = { "男": [], "女": [] };
    students.forEach(function (s, i) { byGender[s.gender].push(i); });
    Object.keys(byGender).forEach(function (g) {
      shuffle(byGender[g], rng);
      byGender[g].sort(function (a, b) { return students[b].total - students[a].total; });
    });

    var assignment = new Array(students.length);

    // 蛇形发牌；女生用镜像班号，使零头落在另一端，班级人数差 ≤1
    function deal(list, mirror) {
      for (var k = 0; k < list.length; k++) {
        var round = Math.floor(k / N), pos = k % N;
        var cls = (round % 2 === 0) ? pos : N - 1 - pos;
        if (mirror) cls = N - 1 - cls;
        assignment[list[k]] = cls;
      }
    }
    deal(byGender["男"], false);
    deal(byGender["女"], true);

    if (opts.optimize !== false) optimize(students, assignment, N, rng, opts.iterations || 40000);
    return assignment;
  }

  /* 同性别跨班交换优化：目标 = 各科(含总分)班级平均分的方差之和，只降不升。
   * 交换不改变班级人数与性别构成。 */
  function optimize(students, assignment, N, rng, iterations) {
    var n = students.length;
    // 每班各科分数和
    var sums = {}, cnt = new Array(N).fill(0);
    SUBJECTS.forEach(function (sub) { sums[sub] = new Array(N).fill(0); });
    for (var i = 0; i < n; i++) {
      var c = assignment[i]; cnt[c]++;
      SUBJECTS.forEach(function (sub) { sums[sub][c] += students[i][sub]; });
    }
    var genderIdx = { "男": [], "女": [] };
    for (i = 0; i < n; i++) genderIdx[students[i].gender].push(i);

    // 各科全体平均分（交换不改变，作为基准）
    var globalMean = {};
    SUBJECTS.forEach(function (sub) {
      var t = 0;
      for (var c = 0; c < N; c++) t += sums[sub][c];
      globalMean[sub] = t / n;
    });

    // 某班在目标函数中的贡献：Σ_科目 (班均分 - 全体均分)²
    function classTerm(c) {
      var t = 0;
      for (var s = 0; s < SUBJECTS.length; s++) {
        var sub = SUBJECTS[s];
        var d = sums[sub][c] / cnt[c] - globalMean[sub];
        t += d * d;
      }
      return t;
    }

    for (var it = 0; it < iterations; it++) {
      var pool = genderIdx[rng() < 0.5 ? "男" : "女"];
      if (pool.length < 2) pool = genderIdx[pool === genderIdx["男"] ? "女" : "男"];
      var a = pool[Math.floor(rng() * pool.length)];
      var b = pool[Math.floor(rng() * pool.length)];
      var ca = assignment[a], cb = assignment[b];
      if (ca === cb) continue;

      var before = classTerm(ca) + classTerm(cb);
      for (var s = 0; s < SUBJECTS.length; s++) {
        var sub = SUBJECTS[s], d = students[a][sub] - students[b][sub];
        sums[sub][ca] -= d; sums[sub][cb] += d;
      }
      var after = classTerm(ca) + classTerm(cb);
      if (after < before - 1e-9) {
        assignment[a] = cb; assignment[b] = ca; // 采纳
      } else {
        for (s = 0; s < SUBJECTS.length; s++) { // 回滚
          sub = SUBJECTS[s]; d = students[a][sub] - students[b][sub];
          sums[sub][ca] += d; sums[sub][cb] -= d;
        }
      }
    }
  }

  // 均衡度统计：每班人数/性别/各科平均分，以及各指标的班级间极差
  function computeStats(students, assignment, N) {
    var classes = [];
    for (var c = 0; c < N; c++) {
      classes.push({ count: 0, male: 0, female: 0, chinese: 0, math: 0, english: 0, total: 0 });
    }
    students.forEach(function (s, i) {
      var k = classes[assignment[i]];
      k.count++;
      if (s.gender === "男") k.male++; else k.female++;
      SUBJECTS.forEach(function (sub) { k[sub] += s[sub]; });
    });
    classes.forEach(function (k) {
      SUBJECTS.forEach(function (sub) { k["avg_" + sub] = k.count ? k[sub] / k.count : 0; });
    });
    function range(get) {
      var vs = classes.map(get);
      return Math.max.apply(null, vs) - Math.min.apply(null, vs);
    }
    var ranges = {
      count: range(function (k) { return k.count; }),
      male: range(function (k) { return k.male; }),
      female: range(function (k) { return k.female; }),
    };
    SUBJECTS.forEach(function (sub) {
      ranges["avg_" + sub] = range(function (k) { return k["avg_" + sub]; });
    });
    return { classes: classes, ranges: ranges };
  }

  /* 对调候选：目标班中与 idx 同性别的学生，按总分接近程度排序（"相同位置"的学生优先） */
  function swapCandidates(students, assignment, idx, targetClass) {
    var me = students[idx], out = [];
    students.forEach(function (s, i) {
      if (i !== idx && assignment[i] === targetClass && s.gender === me.gender) {
        out.push({ index: i, diff: Math.abs(s.total - me.total) });
      }
    });
    out.sort(function (a, b) { return a.diff - b.diff; });
    return out;
  }

  return {
    SUBJECTS: SUBJECTS,
    makeRng: makeRng,
    assign: assign,
    computeStats: computeStats,
    swapCandidates: swapCandidates,
  };
});
