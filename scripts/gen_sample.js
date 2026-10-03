// 生成模拟新生名单 样例名单.xlsx
// 用法: node scripts/gen_sample.js
const XLSX = require("../yunban/ui/xlsx.full.min.js");
const path = require("path");
XLSX.set_fs(require("fs"));

// 简单可复现的伪随机数
let seed = 20260823;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
// 近似正态分布的分数
function score(mean, sd) {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rand();
  let v = Math.round(mean + (s - 3) * sd);
  return Math.max(30, Math.min(100, v));
}

const surnames = "王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文".split("");
const male2 = "伟强磊军洋勇杰涛斌宇浩然轩泽睿博文昊天铭辰志远子墨思聪嘉懿俊驰雨泽烨磊晟睿明健雄".split("");
const female2 = "芳娜敏静丽娟艳婷雪琳晶欣怡梦琪雨嘉可馨语嫣香茹月婵嫦曦靖瑶瑾萱佳琦昕玉歆瑶凌菲".split("");
const schools = ["实验小学", "第一小学", "第二小学", "育才小学", "光明小学", "红旗小学", "东风小学", "希望小学"];

const N_MALE = 208, N_FEMALE = 193; // 共 401 人, 8 个班不能整除, 男女不等且都可能出现奇数
const rows = [];
let id = 1;

function makeStudent(gender) {
  const sn = surnames[Math.floor(rand() * surnames.length)];
  const pool = gender === "男" ? male2 : female2;
  let given = pool[Math.floor(rand() * pool.length)];
  if (rand() < 0.4) given = given[Math.floor(rand() * given.length)];
  // 个体能力基线 + 单科浮动，制造科目间相关性
  const base = 78 + (rand() - 0.5) * 24;
  return {
    "学号": "2026" + String(id++).padStart(4, "0"),
    "姓名": sn + given,
    "性别": gender,
    "毕业小学": schools[Math.floor(rand() * schools.length)],
    "语文": score(base + 2, 8),
    "数学": score(base, 11),
    "英语": score(base + 1, 9),
  };
}

for (let i = 0; i < N_MALE; i++) rows.push(makeStudent("男"));
for (let i = 0; i < N_FEMALE; i++) rows.push(makeStudent("女"));

// 打乱顺序，模拟真实名单
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}

// 制造边界情况：两行脏数据（缺成绩 / 性别非法），用于测试校验
rows.push({ "学号": "20269998", "姓名": "测试缺分", "性别": "男", "毕业小学": "实验小学", "语文": 85, "数学": "", "英语": 90 });
rows.push({ "学号": "20269999", "姓名": "测试性别", "性别": "未知", "毕业小学": "第一小学", "语文": 80, "数学": 75, "英语": 82 });

const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "新生名单");
const out = path.join(__dirname, "..", "样例名单.xlsx");
XLSX.writeFile(wb, out);
console.log("已生成", out, "共", rows.length, "行 (含2行脏数据), 男", N_MALE, "女", N_FEMALE);
