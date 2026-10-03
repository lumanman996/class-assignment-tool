/* 演示名单生成器：固定种子，每次生成同一份虚构数据。
 * 浏览器下挂载为 window.YunbanDemo（页面「载入演示数据」用），Node 下供 scripts/gen_demo.js 生成 Excel。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.YunbanDemo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TITLE = "2026 级七年级新生名单（演示数据）";
  var HEADER = ["学号", "姓名", "性别", "毕业学校", "语文", "数学", "英语", "科学"];
  var N_MALE = 133, N_FEMALE = 124; // 共 257 人，男女都不能被常见班级数整除

  var surnames = "王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文".split("");
  var maleNames = ["浩然", "子轩", "宇航", "俊杰", "梓豪", "一鸣", "博文", "天佑", "明哲", "嘉懿", "睿", "晨", "昊", "峻熙", "思远", "子墨", "煜祺", "志强", "建国", "鹏", "磊", "文博", "雨泽", "皓轩", "承泽"];
  var femaleNames = ["梓涵", "欣怡", "诗涵", "雨桐", "可馨", "思琪", "梦瑶", "佳怡", "语嫣", "婉清", "悦", "琳", "雪", "静怡", "若曦", "紫萱", "晓彤", "心怡", "雅婷", "颖", "婷", "芷若", "一诺", "沐晴", "安琪"];
  // 各小学人数不均，用来演示"打散毕业学校"
  var schools = ["实验小学", "实验小学", "实验小学", "实验小学", "第一小学", "第一小学", "第一小学", "第二小学", "第二小学", "育才小学", "育才小学", "光明小学", "城关小学", "外地转入"];

  /* 返回二维数组：第 1 行标题，第 2 行空，第 3 行表头，其后每行一名学生 */
  function build() {
    var seed = 20261003;
    function rand() {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    }
    function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
    // 近似正态分布的分数
    function score(mean, sd) {
      var s = 0;
      for (var i = 0; i < 6; i++) s += rand();
      return Math.max(25, Math.min(100, Math.round(mean + (s - 3) * sd)));
    }
    function makeStudent(gender, surname) {
      var base = 76 + (rand() - 0.5) * 28; // 个体能力基线，让各科成绩相关
      return {
        "姓名": (surname || pick(surnames)) + pick(gender === "男" ? maleNames : femaleNames),
        "性别": gender,
        "毕业学校": pick(schools),
        "语文": score(base + 3, 7),
        "数学": score(base - 1, 11),
        "英语": score(base + 1, 10),
        "科学": score(base, 9),
      };
    }
    // 双胞胎，用来演示"必须同班 / 必须分开"
    function twins(gender, surname, given, school) {
      return given.map(function (g) {
        var s = makeStudent(gender, surname);
        s["姓名"] = surname + g; s["毕业学校"] = school;
        return s;
      });
    }

    var rows = [], i;
    for (i = 0; i < N_MALE; i++) rows.push(makeStudent("男"));
    for (i = 0; i < N_FEMALE; i++) rows.push(makeStudent("女"));
    [].splice.apply(rows, [0, 2].concat(twins("男", "欧阳", ["文轩", "文昊"], "实验小学")));
    [].splice.apply(rows, [N_MALE, 2].concat(twins("女", "司马", ["若兰", "若竹"], "第一小学")));

    // 打乱顺序，模拟真实名单
    for (i = rows.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = rows[i]; rows[i] = rows[j]; rows[j] = t;
    }

    // 几名缺成绩的学生，用来演示"缺成绩照常分班"
    rows[11]["英语"] = "缺考";
    rows[87]["科学"] = "";
    rows[150]["数学"] = "缺考";
    ["语文", "数学", "英语", "科学"].forEach(function (k) { rows[203][k] = ""; }); // 转学生，无成绩
    rows[203]["毕业学校"] = "外地转入";

    var aoa = [[TITLE], [], HEADER];
    rows.forEach(function (r, k) {
      aoa.push(["2026" + String(k + 1).padStart(3, "0")].concat(HEADER.slice(1).map(function (h) { return r[h]; })));
    });
    return aoa;
  }

  return { build: build, HEADER: HEADER, SHEET: "七年级" };
});
