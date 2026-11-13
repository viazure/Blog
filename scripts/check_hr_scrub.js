/**
 * Regression: HR scrub under metrics — has/no HR, expand/collapse, in-page tips intact.
 * Not a real browser/phone test. Run: node scripts/check_hr_scrub.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PARTIAL = path.join(ROOT, "layouts", "_partials", "session-clock-script.html");

function pass(msg) { console.log("PASS:", msg); }
function fail(msg) { console.error("FAIL:", msg); process.exitCode = 1; throw new Error(msg); }

function extractScript(html) {
  const m = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*$/);
  if (!m) fail("no script block");
  return m[1].replace(/\{\{[\s\S]*?\}\}/g, '"/trails.json"');
}

function staticChecks(html) {
  const need = [
    'id="wk-hr-scrub"',
    'data-wk-hr-toggle',
    'data-wk-hr-canvas',
    'aria-label="展开心率趋势"',
    'var hrScrubEl = dialog.querySelector("[data-wk-hr-scrub]")',
    "function setHrScrub(",
    "function toggleHrScrub(",
    "function drawHrScrub(",
    'ctx.fillStyle = "#d4534a"',
  ];
  for (const n of need) {
    if (!html.includes(n)) fail("missing " + n);
  }
  if (html.includes("wk-tip-sheet") || /\btipSheet\b/.test(html)) {
    fail("leftover #wk-tip-sheet / tipSheet dependency");
  }
  if (!html.includes("openTipSheet") || !html.includes('class="wk-info-tip"')) {
    fail("in-page tip helpers damaged");
  }
  if (!/updateLegend\(session\);\r?\n\s*setHrScrub\(session, item\);/.test(html)) {
    fail("openDetail missing setHrScrub");
  }
  pass("static markup + bindings + openDetail wire");
  if (html.includes("data-wk-hr-hint") || html.includes("点开查看整场") || html.includes("再点收起")) {
    fail("HR hint copy should be removed");
  }
  const tipIdx = html.indexOf("var TIP_COPY =");
  if (tipIdx < 0) fail("TIP_COPY missing");
  const tipChunk = html.slice(tipIdx, tipIdx + 900);
  const metricBodies = {
    kcal: "估算消耗，非实测。",
  };
  for (const [key, body] of Object.entries(metricBodies)) {
    if (!tipChunk.includes('body: "' + body + '"')) fail("TIP_COPY body mismatch for " + key);
  }
  if (/moving\s*:/.test(tipChunk) || tipChunk.includes("实际移动时长") || tipChunk.includes("手表")) {
    fail("用时 tip / 手表 wording should be removed from TIP_COPY");
  }
  if (tipChunk.includes('body: "外圈为强度，中圈为心率，核心为用时，均铺满整场。"')) {
    fail("short sclock tip-sheet copy should be removed; full sentences live in the legend slot");
  }
  if (!html.includes("data-wk-legend-slot")) {
    fail("clock legend slot markup missing");
  }
  if (html.includes("data-wk-legend-info")) {
    fail("legend info mark should be removed");
  }
  if (html.includes('data-wk-tip="sclock"')) {
    fail("sclock should not open a metric tip");
  }
  const drawChunk = html.split("function drawHrScrub")[1].split("function setHrIdxFromClientX")[0];
  if (!drawChunk.includes('fillStyle = "#d4534a"')) fail("solid scrub fill missing");
  if (drawChunk.includes('fillStyle = themeTok("--wk-sheet"')) fail("hollow scrub fill still present");
}

function makeEl(id, attrs) {
  const classList = {
    _set: new Set(),
    add(c) { this._set.add(c); },
    remove(c) { this._set.delete(c); },
    contains(c) { return this._set.has(c); },
    toggle(c, on) {
      if (on == null) on = !this._set.has(c);
      if (on) this._set.add(c); else this._set.delete(c);
      return on;
    },
  };
  const el = {
    id: id || "",
    attrs: Object.assign({}, attrs || {}),
    hidden: !!(attrs && attrs.hidden),
    open: false,
    style: {},
    textContent: "",
    innerHTML: "",
    classList,
    children: [],
    parent: null,
    getContext() {
      return {
        setTransform() {},
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        createLinearGradient() { return { addColorStop() {} }; },
        fill() {},
        stroke() {},
        arc() {},
      };
    },
    getBoundingClientRect() { return { left: 0, width: 320, top: 0, height: 88 }; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] == null ? null : String(this.attrs[k]); },
    querySelector(sel) {
      return find(this, sel);
    },
    querySelectorAll(sel) {
      const out = [];
      walk(this, (n) => { if (match(n, sel)) out.push(n); });
      return out;
    },
    closest(sel) {
      let n = this;
      while (n) {
        if (match(n, sel)) return n;
        n = n.parent;
      }
      return null;
    },
    contains(other) {
      let n = other;
      while (n) {
        if (n === this) return true;
        n = n.parent;
      }
      return false;
    },
    addEventListener() {},
    setPointerCapture() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    clientWidth: 320,
  };
  return el;
}

function match(el, sel) {
  if (!el || !sel) return false;
  if (sel.startsWith("#")) return el.id === sel.slice(1);
  if (sel.startsWith(".")) return (el.attrs.class || "").split(/\s+/).includes(sel.slice(1)) || el.classList.contains(sel.slice(1));
  if (sel.startsWith("[") && sel.endsWith("]")) {
    const body = sel.slice(1, -1);
    const eq = body.indexOf("=");
    if (eq < 0) return el.attrs[body] != null || (body === "hidden" && el.hidden);
    let key = body.slice(0, eq);
    let val = body.slice(eq + 1).replace(/^["']|["']$/g, "");
    return String(el.getAttribute(key)) === val;
  }
  if (sel.includes("[")) {
    const m = sel.match(/^([a-zA-Z0-9_-]+)(\[.+\])$/);
    if (m) return (el.tag === m[1] || el.attrs.tag === m[1]) && match(el, m[2]);
  }
  return el.tag === sel || el.attrs.tag === sel || el.id === sel;
}

function walk(el, fn) {
  fn(el);
  (el.children || []).forEach((c) => walk(c, fn));
}

function find(root, sel) {
  let hit = null;
  walk(root, (n) => { if (!hit && match(n, sel)) hit = n; });
  return hit;
}

function buildDom() {
  const dialog = makeEl("wk-detail");
  dialog.tag = "dialog";
  const title = makeEl("wk-detail-title");
  const when = makeEl("", { class: "wk-detail-when" });
  const sportName = makeEl("", { class: "wk-sport-name" });
  const sportPill = makeEl("", { class: "wk-sport-pill" });
  const metrics = makeEl("", { class: "wk-metrics" });
  const hr = makeEl("wk-hr-scrub", { "data-wk-hr-scrub": "", hidden: true });
  hr.hidden = true;
  const hrToggle = makeEl("", { "data-wk-hr-toggle": "", "aria-expanded": "false" });
  const hrHint = makeEl("", { "data-wk-hr-hint": "" });
  hrHint.textContent = "点开查看整场";
  const hrTime = makeEl("", { "data-wk-hr-time": "", class: "t" });
  const hrBpm = makeEl("", { "data-wk-hr-bpm": "", class: "bpm" });
  const hrWrap = makeEl("", { "data-wk-hr-wrap": "" });
  const hrCanvas = makeEl("", { "data-wk-hr-canvas": "" });
  const hrAxisStart = makeEl("", { "data-wk-hr-axis-start": "" });
  const hrAxisMid = makeEl("", { "data-wk-hr-axis-mid": "" });
  const hrAxisEnd = makeEl("", { "data-wk-hr-axis-end": "" });
  const legend = makeEl("", { class: "wk-legend" });
  const legendSlot = makeEl("wk-legend-slot", { "data-wk-legend-slot": "" });
  const legendInner = makeEl("", { "data-legend-inner-copy": "" });
  const legendInnerKey = makeEl("", { class: "wk-legend-key", "data-layer": "inner" });
  const tools = makeEl("", { class: "wk-viz-tools" });
  const mapPanel = makeEl("", { "data-panel": "map" });
  const clockPanel = makeEl("", { "data-panel": "clock" });
  const mapSvg = makeEl("", { class: "wk-map", tag: "svg" });
  const clockSvg = makeEl("", { class: "wk-sclock", tag: "svg" });
  const pager = makeEl("", { class: "wk-pager" });

  function adopt(parent, child) {
    child.parent = parent;
    parent.children.push(child);
  }
  [
    title, when, sportName, sportPill, metrics, hr, legend, tools,
    mapPanel, clockPanel, mapSvg, clockSvg, pager
  ].forEach((c) => adopt(dialog, c));
  adopt(hr, hrToggle);
  adopt(hr, hrHint);
  const panel = makeEl("wk-hr-scrub-panel");
  adopt(hr, panel);
  adopt(panel, hrTime);
  adopt(panel, hrBpm);
  adopt(panel, hrWrap);
  adopt(hrWrap, hrCanvas);
  adopt(panel, hrAxisStart);
  adopt(panel, hrAxisMid);
  adopt(panel, hrAxisEnd);
  adopt(legend, legendSlot);
  adopt(legend, legendInnerKey);
  adopt(legendInnerKey, legendInner);

  const byId = {
    "wk-detail": dialog,
    "wk-detail-title": title,
    "wk-hr-scrub": hr,
    "wk-hr-scrub-panel": panel,
  };

  const document = {
    documentElement: { classList: { contains() { return false; } } },
    readyState: "complete",
    getElementById(id) { return byId[id] || null; },
    querySelector(sel) {
      if (sel === "#wk-detail-title") return title;
      return find(dialog, sel);
    },
    querySelectorAll(sel) {
      if (sel.startsWith(".run-card")) return [];
      const out = [];
      walk(dialog, (n) => { if (match(n, sel)) out.push(n); });
      return out;
    },
    addEventListener() {},
  };

  dialog.querySelector = function (sel) {
    if (sel === "#wk-detail-title") return title;
    return find(dialog, sel);
  };

  const windowObj = {
    __wkTrails: null,
    matchMedia() { return { matches: false }; },
    devicePixelRatio: 1,
    addEventListener() {},
    requestAnimationFrame(fn) { fn(); },
  };

  return { document, window: windowObj, dialog, hr, hrToggle, metrics };
}

function runVm(script, extra) {
  const dom = buildDom();
  const sandbox = {
    console,
    window: dom.window,
    document: dom.document,
    getComputedStyle() { return { getPropertyValue() { return ""; } }; },
    Object,
    Math,
    Number,
    String,
    Array,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    requestAnimationFrame(fn) { fn(); },
  };
  sandbox.window.document = dom.document;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(script, sandbox, { filename: "session-clock-script.js" });
  return Object.assign({ sandbox }, dom);
}

function main() {
  console.log("HR scrub regression — NOT a real browser/phone test");
  const html = fs.readFileSync(PARTIAL, "utf8");
  staticChecks(html);
  const script = extractScript(html);
  const syn = spawnSync(process.execPath, ["--check"], { input: script, encoding: "utf8" });
  if (syn.status !== 0) fail("node --check failed: " + syn.stderr);
  pass("extracted script node --check");

  // Syntax/init with mock — tip still opens
    // Call setHrScrub via openDetail path is heavy; call through eval of exposed? Not exposed.
  // Instead: simulate by invoking document click after manually setting via sandbox? Functions are closed.
  // Use a thin harness: re-run with injected hooks by wrapping — simpler approach:
  // Execute setHrScrub by evaluating a probe that reaches into... can't.
  // So duplicate minimal behavioral checks against pure helper extract? Better: patch script to export.
  // Minimal: assert functions exist in source + simulate UI state transitions on our DOM using a second micro-script.

  // Behavioral unit using the same helpers copied? Prefer extracting by Function from source markers.
  const helpers = script.match(/function fmtElapsedSec[\s\S]*?function fillMeta/);
  if (!helpers) fail("could not extract HR helpers");
  // Build a tiny sandbox to exercise setHrScrub/toggle by injecting DOM vars
  const unit = `
var hrScrubEl, hrToggleBtn, hrHintEl, hrTimeEl, hrBpmEl, hrWrapEl, hrCanvas;
var hrAxisStart, hrAxisMid, hrAxisEnd;
var hrSeries = [], hrMovingSec = 0, hrStartMin = null, hrIdx = 0, hrDragging = false;
function themeTok(n,f){return f;}
function isDarkTheme(){return false;}
${helpers[0].replace(/function fillMeta[\s\S]*$/, "")}
function __probe(has) {
  var session = has ? { hr: [120,130,140,150,160], moving: 1800 } : { bars: [1,1,1], moving: 600 };
  var item = { time: "16:28", moving: session.moving };
  setHrScrub(session, item);
  return {
    hidden: !!hrScrubEl.hidden,
    open: hrScrubEl.classList.contains("is-open"),
    expanded: hrToggleBtn.getAttribute("aria-expanded"),
    label: hrToggleBtn.getAttribute("aria-label"),
    axisEnd: hrAxisEnd.textContent,
    bpm: hrBpmEl.textContent
  };
}
function __toggle(){ toggleHrScrub(); return { open: hrScrubEl.classList.contains("is-open"), expanded: hrToggleBtn.getAttribute("aria-expanded"), label: hrToggleBtn.getAttribute("aria-label") }; }
`;
  const uDom = buildDom();
  const uSand = {
    console,
    Math, Number, String, Array, Object, JSON,
    window: uDom.window,
    document: uDom.document,
    requestAnimationFrame(fn) { fn(); },
    getComputedStyle() { return { getPropertyValue() { return ""; } }; },
  };
  vm.runInNewContext(unit, uSand, { filename: "hr-unit.js" });
  // bind DOM vars into sandbox
  uSand.hrScrubEl = uDom.hr;
  uSand.hrToggleBtn = uDom.hrToggle;
  uSand.hrHintEl = null;
  uSand.hrTimeEl = uDom.hr.querySelector("[data-wk-hr-time]");
  uSand.hrBpmEl = uDom.hr.querySelector("[data-wk-hr-bpm]");
  uSand.hrWrapEl = uDom.hr.querySelector("[data-wk-hr-wrap]");
  uSand.hrCanvas = uDom.hr.querySelector("[data-wk-hr-canvas]");
  uSand.hrAxisStart = uDom.hr.querySelector("[data-wk-hr-axis-start]");
  uSand.hrAxisMid = uDom.hr.querySelector("[data-wk-hr-axis-mid]");
  uSand.hrAxisEnd = uDom.hr.querySelector("[data-wk-hr-axis-end]");

  const has = uSand.__probe(true);
  if (has.hidden) fail("has HR should show block");
  if (has.open || has.expanded !== "false") fail("should start collapsed");
  if (!/bpm/.test(has.bpm)) fail("bpm readout missing");
  if (has.axisEnd !== "30:00") fail("axis end expected 30:00 got " + has.axisEnd);
  pass("has HR: visible + collapsed + readout");

  if (has.label !== "展开心率趋势") fail("collapsed aria-label expected 展开心率趋势 got " + has.label);

  const opened = uSand.__toggle();
  if (!opened.open || opened.expanded !== "true") fail("toggle open failed");
  if (opened.label !== "收起心率趋势") fail("open aria-label expected 收起心率趋势 got " + opened.label);
  pass("expand");

  const closed = uSand.__toggle();
  if (closed.open || closed.expanded !== "false") fail("toggle close failed");
  if (closed.label !== "展开心率趋势") fail("close aria-label expected 展开心率趋势 got " + closed.label);
  pass("collapse");

  const no = uSand.__probe(false);
  if (!no.hidden) fail("no HR should hide block");
  if (no.open) fail("no HR should not stay open");
  pass("no HR: hidden (no empty shell)");

  if (html.includes("wk-tip-sheet") || !html.includes("openTipSheet") || !html.includes('class="wk-info-tip"')) {
    fail("in-page tip helpers damaged");
  }
  pass("in-page tip helpers intact");

  if (process.exitCode) fail("had failures");
  console.log("ALL PASS — HR scrub has/no + expand/collapse; in-page tips kept");
}

main();
