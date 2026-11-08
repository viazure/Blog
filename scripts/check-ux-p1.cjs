const fs = require("fs");
const path = require("path");
const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS:", msg);
}

// 1) heading CSS values in _custom.scss
{
  const s = read("assets/sass/_custom.scss");
  assert(s.includes("article .page-content"), "headings scoped under article .page-content");
  assert(!/header-title[\s\S]{0,40}font-size:\s*1\.5rem/.test(s), "does not shrink .header-title via this block");
  assert(/h2\s*\{[^}]*font-size:\s*1\.5rem/s.test(s), "h2 1.5rem");
  assert(/h2\s*\{[^}]*font-weight:\s*700/s.test(s), "h2 weight 700");
  assert(/h2\s*\{[^}]*margin-top:\s*1\.85rem/s.test(s), "h2 margin-top");
  assert(/h2\s*\{[^}]*margin-bottom:\s*0\.45rem/s.test(s), "h2 margin-bottom");
  assert(/h3\s*\{[^}]*font-size:\s*1\.25rem/s.test(s), "h3 1.25rem");
  assert(/h3\s*\{[^}]*font-weight:\s*650/s.test(s), "h3 weight 650");
  assert(/h4\s*\{[^}]*font-size:\s*1\.125rem/s.test(s), "h4 1.125rem");
  assert(/h4\s*\{[^}]*font-weight:\s*600/s.test(s), "h4 weight 600");
  assert(/h1\s*\{[^}]*font-size:\s*1\.625rem/s.test(s), "h1 1.625rem");
  assert(/a\.post-meta-cat/.test(s), "post-meta-cat styles present");
  assert(/:visited/.test(s), "post-meta-cat visited inherits");
  assert(!/\.post-meta-tags/.test(s), "post-meta-tags styles removed");
  assert(!/a\.post-meta-tag/.test(s), "post-meta-tag styles removed");
  assert(!/a\.post-meta-tax/.test(s), "old post-meta-tax style removed");
  assert(/font-size:\s*0\.82rem/.test(s), "post-meta font ~0.82rem");
}

// 2) author margins
{
  const s = read("assets/sass/_layout.scss");
  assert(/\.author\s*\{[^}]*margin-top:\s*4\.5rem/s.test(s), "author margin-top 4.5rem");
  assert(/\.author\s*\{[^}]*margin-bottom:\s*3\.5rem/s.test(s), "author margin-bottom 3.5rem");
  assert(/@include media-query\(\$on-mobile\)\s*\{\s*margin-top:\s*3\.5rem/s.test(s), "mobile author margin-top 3.5rem");
  assert(/margin-bottom:\s*3em/.test(s), "mobile author margin-bottom ~3em kept");
  assert(!/margin-top:\s*6\.3rem/.test(s), "old 6.3rem gone");
  assert(!/margin-bottom:\s*7\.2rem/.test(s), "old 7.2rem gone");
}

// 3) toc site default + threshold
{
  const toml = read("hugo.toml");
  assert(/toc\s*=\s*false/.test(toml), "hugo.toml toc=false (opt-in)");
  assert(!/toc\s*=\s*true/.test(toml), "hugo.toml toc not true");
  const toc = read("layouts/_partials/toc.html");
  assert(toc.includes('findRE "<h2" .Content'), "toc counts h2 via findRE");
  assert(/ge \$h2count 3/.test(toc), "toc requires h2count >= 3");
  assert(!/gt \(len \.TableOfContents\) 32/.test(toc), "old len>32 gate removed");
  assert(toc.includes('id="toc-fab"'), "toc-fab still present");
  assert(toc.includes('id="post-toc"'), "post-toc still present");
}

// 4) post-meta: date · categories only (no tags)
{
  const s = read("layouts/single.html");
  assert(s.includes("$.Params.categories"), "categories after date");
  assert(s.includes("post-meta-cat"), "post-meta-cat class");
  assert(s.includes("post-meta-sep"), "post-meta-sep for date·cat");
  assert(!s.includes("Params.tags"), "tags not rendered in post-meta");
  assert(!s.includes("post-meta-tags"), "post-meta-tags row removed");
  assert(!s.includes("post-meta-tag"), "post-meta-tag class removed");
  assert(!s.includes("post-meta-tax"), "old post-meta-tax removed");
  assert(s.includes('class="header-title"'), "header-title unchanged");
}

console.log("\nALL CHECKS PASSED");
