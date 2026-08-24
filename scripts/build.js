// 把 xlsx.full.min.js 和 algo.js 内嵌进 index.html，生成单文件 分班工具.html
// 用法: node scripts/build.js
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const lib of ["xlsx.full.min.js", "algo.js"]) {
  const code = fs.readFileSync(path.join(root, lib), "utf8");
  const tag = `<script src="${lib}"></script>`;
  if (!html.includes(tag)) { console.error(`未找到标签: ${tag}`); process.exit(1); }
  html = html.replace(tag, () => `<script>\n${code}\n</script>`);
}
const out = path.join(root, "分班工具.html");
fs.writeFileSync(out, html);
console.log("已生成", out, `(${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
