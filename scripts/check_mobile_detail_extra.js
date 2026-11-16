/**
 * Regression: mobile workout detail shows metrics + HR directly under the chart,
 * desktop unchanged, no dialog.wk-detail flex/min-height:0 + sheet flex:1.
 * Not a real browser/phone test. Run: node scripts/check_mobile_detail_extra.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PARTIAL = path.join(ROOT, "layouts", "_partials", "session-clock-script.html");
const SCRIPT = path.join(ROOT, "assets", "js", "session-clock.js");
const SCSS = path.join(ROOT, "assets", "sass", "_workouts.scss");

function pass(msg) { console.log("PASS:", msg); }
function fail(msg) { console.error("FAIL:", msg); process.exitCode = 1; throw new Error(msg); }

function read(p) {
  if (!fs.existsSync(p)) fail("missing " + p);
  return fs.readFileSync(p, "utf8");
}

function mobileDetailBlock(scss) {
  const needle = ".wk-detail-more:not(.wk-detail-more-end)";
  const at = scss.indexOf(needle);
  if (at < 0) fail("mobile more-button rules missing");
  const start = scss.lastIndexOf("@include wk-detail-compact", at);
  if (start < 0) fail("could not find compact media-query for detail more");
  // brace-match from the include's opening {
  const open = scss.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < scss.length; i++) {
    if (scss[i] === "{") depth++;
    else if (scss[i] === "}") {
      depth--;
      if (depth === 0) return scss.slice(start, i + 1);
    }
  }
  fail("unclosed mobile detail block");
}

function dialogRule(block) {
  const m = block.match(/\.wk-detail\s*\{([\s\S]*?)\n  \}/);
  return m ? m[1] : "";
}

function staticChecks(html, script, scss) {
  const src = html + "\n" + script + "\n" + scss;
  const need = [
    'data-wk-detail-more',
    'id="wk-detail-extra"',
    'aria-controls="wk-detail-extra"',
    "data-wk-detail-more-end",
    "wk-hr-scrub-heading",
    "function setExtraOpen(",
    "function isMobileDetail(",
    "function resetMobileDetailState(",
    "function syncPagerPlacement(",
    "function revealChartIfNeeded(",
    "function syncMobileVizCenter(",
    "function isHrScrubInteractive(",
    "wk-detail-viz-stack",
    "100svh",
    "wk-detail-compact",
    "--wk-viz-pad-top",
    "wk-detail-more-chip",
    'data-wk-hr-toggle',
    'aria-label="展开心率趋势"',
  ];
  for (const n of need) {
    if (!src.includes(n)) fail("missing " + n);
  }
  if (!html.includes('class="wk-split-link"')) fail("split link markup removed");
  const mobile = mobileDetailBlock(scss);
  if (mobile.includes('min(100%, 280px, 36dvh)')) {
    fail("mobile chart still uses 280px/36dvh squeeze");
  }
  if (mobile.includes("min(100%, 320px)") || mobile.includes("min(100%, 340px)")) {
    fail("mobile chart still uses a fixed pixel cap");
  }
  if (!/\.wk-viz-stage\s*\{[\s\S]*?width:\s*(unquote\()?["']?100%/.test(mobile) && !mobile.includes("width: 100%")) {
    fail("mobile chart must be 100% of the metrics row width");
  }
  if (!mobile.includes("aspect-ratio: 1")) fail("mobile chart must stay square");
  const layoutStart = mobile.indexOf(".wk-detail-layout");
  const layoutRule = layoutStart >= 0 ? mobile.slice(layoutStart, layoutStart + 420) : "";
  if (/padding-left:\s*0\.65rem/.test(layoutRule)) fail("mobile layout still has the left inset");
  if (!/display:\s*none\s*!important/.test(mobile) || !mobile.includes(".wk-hr-scrub-toggle")) {
    fail("mobile must hide the HR toggle");
  }
  if (!mobile.includes(".wk-hr-scrub-panel") || !mobile.includes("display: block")) {
    fail("mobile must show the HR panel under the chart");
  }
  if (!mobile.includes(".wk-detail-more") || !/display:\s*none\s*!important/.test(mobile.slice(mobile.indexOf(".wk-detail-more"), mobile.indexOf(".wk-detail-more") + 400))) {
    fail("mobile must hide the 查看详情 capsule");
  }
  if (mobile.includes(".wk-detail:not(.is-extra-open) .wk-detail-extra")) {
    fail("mobile must not fold metrics behind is-extra-open");
  }
  const deskTwoCol = scss.split("@media").filter((b) => b.includes("min-height: 35rem") && b.includes(".wk-detail-sheet")).pop() || "";
  if (/\.wk-hr-scrub\s*\{[^}]*display:\s*none/.test(deskTwoCol)) {
    fail("desktop two-column sheet must not hide 心率趋势");
  }
  if (!/display:\s*none\s*!important/.test(deskTwoCol) || !deskTwoCol.includes(".wk-hr-scrub-toggle")) {
    fail("desktop must hide the HR toggle and show the trend in the scroller");
  }
  if (!deskTwoCol.includes(".wk-hr-scrub-panel") || !deskTwoCol.includes("display: block")) {
    fail("desktop must show the HR panel in the right-column scroller");
  }
  if (!deskTwoCol.includes("minmax(0, 1fr)")) {
    fail("desktop row 4 must be the scrolling metrics + HR area");
  }
  // Desktop no longer reserves a two-line empty description slot.
  const slotRule = scss.match(/\.wk-legend-slot\s*\{([\s\S]*?)\n\}/);
  if (!slotRule || slotRule[1].includes("min-height: calc(2 * 1.5em)")) {
    fail("legend slot must not reserve a two-line min-height");
  }
  if (slotRule && !/min-height:\s*0/.test(slotRule[1])) fail("legend slot must collapse when empty");
  if (/max-height\s*:/.test(slotRule[1])) fail("legend slot must not gain a max-height");
  if (!scss.includes(".wk-legend-pop") || !scss.includes(".wk-legend-overlay")) {
    fail("desktop legend copy must use a popover and in-chart overlay");
  }
  if (!deskTwoCol.includes("display: flex !important") || !deskTwoCol.includes(".wk-legend[hidden]")) {
    fail("desktop trail must reserve the keys-row height while hiding the icons");
  }
  if (deskTwoCol.includes("--wk-legend-stack: 0px")) {
    fail("desktop must keep the same keys-row stack on trail and Clock");
  }
  if (!scss.includes("--wk-legend-stack: calc(12px + 3rem)")) {
    fail("legend stack must be the keys row only, not a two-line text slot");
  }
  if (mobile.includes(".wk-legend-slot") && /max-height\s*:/.test(mobile.slice(mobile.indexOf(".wk-legend-slot"), mobile.indexOf(".wk-legend-slot") + 280))) {
    fail("mobile must not cap the legend slot");
  }
  if (script.includes("classList.toggle(\"is-reserved\"")) fail("mobile trail must not reserve an empty legend gap");
  if (!mobile.includes("--wk-viz-pad-top")) fail("mobile stack still references the (now unused) pad var");
  if (!mobile.includes("100svh")) fail("mobile sheet height must prefer svh");
  if (!html.includes("wk-detail-viz-stack")) fail("missing viz stack wrapper");
  const tabStart = mobile.indexOf(".wk-viz-tab {");
  if (tabStart < 0) fail("mobile viz tab rule missing");
  const tabChunk = mobile.slice(tabStart, mobile.indexOf(".wk-split-link", tabStart));
  if (!tabChunk.includes("padding: 0.28rem 0.6rem") || !tabChunk.includes("font-size: 0.78rem")) {
    fail("mobile 轨迹/Clock visual padding/type should match desktop");
  }
  if (/min-height:\s*44px/.test(tabChunk.split("&::before")[0])) {
    fail("mobile tab visual box must not be min-height 44px (use an invisible hit area)");
  }
  if (!tabChunk.includes("&::before") || !tabChunk.includes("width: 44px") || !tabChunk.includes("height: 44px")) {
    fail("mobile tabs must keep a 44px invisible hit area");
  }
  const splitStart = mobile.indexOf("a.wk-split-link");
  if (splitStart < 0) fail("mobile split-link rule missing");
  const splitChunk = mobile.slice(splitStart, mobile.indexOf(".wk-info-btn", splitStart));
  const splitLayout = splitChunk.split("&::before")[0];
  if (!splitLayout.includes("width: 32px") || !splitLayout.includes("height: 32px")) {
    fail("mobile split visible box should match the desktop 32px disc so the 8px gap is the visible gap");
  }
  if (/width:\s*44px/.test(splitLayout) || /min-width:\s*44px/.test(splitLayout)) {
    fail("mobile split layout box must not be 44px (that adds 14px inner gap)");
  }
  const splitHit = splitChunk.includes("&::before") ? splitChunk.slice(splitChunk.indexOf("&::before")) : "";
  if (!splitHit || !/width:\s*44px/.test(splitHit) || !/height:\s*44px/.test(splitHit)) {
    fail("mobile split link must keep a 44px invisible hit area");
  }
  if (splitLayout.includes("margin: -14px 0")) {
    fail("mobile split link should not use -14px vertical margin on a 44px box");
  }
  const dlg = dialogRule(mobile);
  if (/display\s*:\s*flex/.test(dlg)) {
    fail("dialog.wk-detail must not use display:flex in the mobile block");
  }
  if (/min-height\s*:\s*0/.test(dlg) && /flex\s*:\s*1/.test(mobile.match(/\.wk-detail-sheet\s*\{([\s\S]*?)\n  \}/)[1] || "")) {
    fail("dialog min-height:0 + sheet flex:1 regression risk");
  }
  // Desktop default still hides the more button and heading.
  const beforeMobile = scss.slice(0, scss.lastIndexOf("@include wk-detail-compact", scss.indexOf(".wk-detail-more:not(.wk-detail-more-end)")));
  if (!beforeMobile.includes(".wk-detail-more") || !beforeMobile.includes("display: none")) {
    fail("desktop must keep .wk-detail-more hidden");
  }
  if (!script.includes('(max-width: 768px), (max-height: 600px)')) {
    fail("MOBILE_DETAIL_MQ must treat short viewports as compact");
  }
  if (!scss.includes("@media screen and (max-width: $on-mobile), screen and (max-height: $wk-detail-compact-max-height)")) {
    fail("CSS compact query must use the same width OR height contract as JS");
  }
  if (!scss.includes("wk-detail-compact-max-height: 600px")) {
    fail("compact detail height floor must stay 600px");
  }
  if (!scss.includes("min-height: $wk-detail-compact-max-height + 1px")) {
    fail("short-desktop MQ must not apply at height 600px and under");
  }
  if (script.includes("drawSessionClock") === false) fail("clock draw missing");
  if (/setExtraOpen\([\s\S]{0,200}drawSessionClock/.test(script) || /setExtraOpen\([\s\S]{0,200}appearDrawnClock/.test(script)) {
    fail("setExtraOpen must not redraw / restart the clock");
  }
  if (src.includes("wk-tip-sheet")) fail("leftover tip-sheet");
  pass("static markup, mobile CSS contract, desktop HR in scroller, no flex-chain");
}

function extractHelpers(script) {
  const start = script.indexOf("function isMobileDetail(");
  const end = script.indexOf("function resetDetailScroll(");
  if (start < 0 || end < 0 || end <= start) fail("could not extract mobile extra helpers");
  return script.slice(start, end);
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
    inert: false,
    style: {},
    textContent: "",
    innerHTML: "",
    classList,
    children: [],
    parent: null,
    get parentNode() { return this.parent; },
    scrollTop: 0,
    getBoundingClientRect() {
      return this._rect || { left: 0, top: 0, right: 320, bottom: 80, width: 320, height: 80 };
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] == null ? null : String(this.attrs[k]); },
    hasAttribute(k) { return this.attrs[k] != null; },
    querySelector(sel) {
      let hit = null;
      const walk = (n) => {
        if (hit) return;
        if (match(n, sel)) { hit = n; return; }
        (n.children || []).forEach(walk);
      };
      walk(this);
      return hit;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        if (match(n, sel)) out.push(n);
        (n.children || []).forEach(walk);
      };
      walk(this);
      return out;
    },
    contains(other) {
      let n = other;
      while (n) {
        if (n === this) return true;
        n = n.parent;
      }
      return false;
    },
    appendChild(child) {
      if (child.parent) {
        const sib = child.parent.children;
        const i = sib.indexOf(child);
        if (i >= 0) sib.splice(i, 1);
      }
      child.parent = this;
      this.children.push(child);
      return child;
    },
    focus() { this._focused = true; },
  };
  if (attrs && attrs.class) classList._set = new Set(String(attrs.class).split(/\s+/));
  return el;
}

function match(el, sel) {
  if (!el || !sel) return false;
  if (sel.startsWith("#")) return el.id === sel.slice(1);
  if (sel.startsWith(".")) {
    return (el.attrs.class || "").split(/\s+/).includes(sel.slice(1)) || el.classList.contains(sel.slice(1));
  }
  if (sel.startsWith("[") && sel.endsWith("]")) {
    const body = sel.slice(1, -1);
    const eq = body.indexOf("=");
    if (eq < 0) return el.attrs[body] != null || (body === "hidden" && el.hidden);
    const key = body.slice(0, eq);
    const val = body.slice(eq + 1).replace(/^["']|["']$/g, "");
    return String(el.getAttribute(key)) === val;
  }
  return el.id === sel || el.attrs.tag === sel;
}

function runUnit(script, opts) {
  const viewport = {
    width: opts === true || (opts && opts.mobile) ? 390 : 1280,
    height: opts && opts.short ? 390 : 800,
  };
  const frames = [];
  const queued = !!(opts && opts.queued);
  const layout = makeEl("", { class: "wk-detail-layout" });
  const stack = makeEl("", { class: "wk-detail-viz-stack" });
  const dialog = makeEl("wk-detail", { class: "wk-detail" });
  dialog.open = true;
  const sheet = makeEl("", { class: "wk-detail-sheet" });
  const body = makeEl("", { class: "wk-detail-body" });
  const meta = makeEl("", { class: "wk-detail-meta" });
  const moreBtn = makeEl("", { "data-wk-detail-more": "", "aria-expanded": "false" });
  const moreLabel = makeEl("", { class: "wk-detail-more-label" });
  moreLabel.textContent = "查看详情";
  const moreEnd = makeEl("", { "data-wk-detail-more-end": "", hidden: true });
  moreEnd.hidden = true;
  const extra = makeEl("wk-detail-extra", { class: "wk-detail-extra" });
  const metrics = makeEl("", { class: "wk-metrics" });
  const hr = makeEl("wk-hr-scrub", { "data-wk-hr-scrub": "" });
  const pager = makeEl("", { class: "wk-pager" });
  const chart = makeEl("", { class: "wk-viz-stage-wrap" });
  chart._rect = { left: 0, top: 20, right: 300, bottom: 320, width: 300, height: 300 };
  body._rect = { left: 0, top: 0, right: 400, bottom: 500, width: 400, height: 500 };
  moreBtn._rect = { left: 0, top: 330, right: 400, bottom: 374, width: 400, height: 44 };
  extra._rect = { left: 0, top: 380, right: 400, bottom: 900, width: 400, height: 520 };

  stack.getBoundingClientRect = function () {
    const top = 80 + parseFloat(layout.style["--wk-viz-pad-top"] || 0) - body.scrollTop;
    return { top, bottom: top + 380, height: 380 };
  };

  chart.getBoundingClientRect = function () {
    const top = stack.getBoundingClientRect().top;
    return { top, bottom: top + 300, width: 300, height: 300 };
  };
  moreBtn.getBoundingClientRect = function () {
    const bottom = stack.getBoundingClientRect().bottom;
    return { top: bottom - 44, bottom, height: 44 };
  };
  extra.getBoundingClientRect = function () {
    const top = stack.getBoundingClientRect().bottom + 6;
    return { top, bottom: top + 520, height: 520 };
  };

  const adopt = (p, c) => { c.parent = p; p.children.push(c); };
  adopt(dialog, sheet);
  adopt(sheet, body);
  adopt(body, chart);
  adopt(body, moreBtn);
  adopt(moreBtn, moreLabel);
  adopt(body, extra);
  adopt(extra, metrics);
  adopt(extra, hr);
  adopt(sheet, meta);
  adopt(meta, pager);
  adopt(dialog, moreEnd); // reachable via query

  dialog.querySelector = function (sel) {
    if (sel === ".wk-detail-layout") return layout;
    if (sel === ".wk-detail-viz-stack") return stack;
    if (sel === ".wk-detail-body") return body;
    if (sel === ".wk-detail-sheet") return sheet;
    if (sel === "#wk-detail-extra") return extra;
    if (sel === "[data-wk-detail-more]") return moreBtn;
    if (sel === "[data-wk-detail-more-end]") return moreEnd;
    if (sel === ".wk-viz-stage-wrap") return chart;
    if (sel === ".wk-viz-stage") return chart;
    const q = (n) => {
      if (match(n, sel)) return n;
      for (const c of n.children || []) {
        const h = q(c);
        if (h) return h;
      }
      return null;
    };
    return q(this);
  };

  const helpers = extractHelpers(script);
  const sandbox = {
    console,
    Math, Number, String, Array, Object, JSON,
    window: {
      matchMedia(q) {
        return { matches: String(q).split(",").some(part => {
          if (part.includes("orientation: landscape")) return viewport.width > viewport.height;
          const w = part.match(/max-width:\s*(\d+)px/);
          const h = part.match(/max-height:\s*(\d+)px/);
          return !!((w || h) && (!w || viewport.width <= +w[1]) && (!h || viewport.height <= +h[1]));
        }) };
      },
    },
    document: {},
    requestAnimationFrame(fn) { if (queued) frames.push(fn); else fn(); },
    dialog,
    moreBtn,
    moreEndBtn: moreEnd,
    extraEl: extra,
    metricsEl: metrics,
    sheetEl: sheet,
    pager,
    pagerHome: meta,
    extraScrollY: 0,
    MOBILE_DETAIL_MQ: script.match(/var MOBILE_DETAIL_MQ = "([^"]+)"/)[1],
    hrScrubEl: hr,
    hrSeries: [120, 130],
    updateHrReadout() { sandbox._hrDrawn = (sandbox._hrDrawn || 0); sandbox._hrRead = true; },
    drawHrScrub() { sandbox._hrDrawn = (sandbox._hrDrawn || 0) + 1; },
  };
  vm.runInNewContext(helpers, sandbox, { filename: "mobile-extra-unit.js" });
  return { sandbox, dialog, extra, moreBtn, moreLabel, moreEnd, pager, meta, sheet, body, hr, layout, stack, viewport,
    flush() { let n = 0; while (frames.length) { if (++n > 50) fail("rAF loop"); frames.shift()(); } },
  };
}

function behavior(script) {
  const mobile = runUnit(script, true);
  mobile.sandbox.resetMobileDetailState();
  if (!mobile.dialog.classList.contains("is-extra-open")) fail("mobile should show metrics by default");
  if (mobile.extra.hidden || mobile.extra.inert) fail("mobile extra should be visible");
  if (!mobile.moreBtn.hidden || !mobile.moreEnd.hidden) fail("mobile must hide the 查看详情 buttons");
  if (!mobile.sandbox._hrDrawn) fail("mobile should draw HR trend without a second click");
  pass("mobile default shows metrics+HR, hides the capsule");

  mobile.body.scrollTop = 240;
  mobile.sandbox.setExtraOpen(false, { saveScroll: false, scroll: true, focus: false });
  if (!mobile.dialog.classList.contains("is-extra-open") || mobile.extra.hidden) {
    fail("mobile must ignore collapse and keep metrics visible");
  }
  pass("mobile does not fold metrics away");

  mobile.sandbox.resetMobileDetailState();
  if (!mobile.dialog.classList.contains("is-extra-open") || mobile.extra.hidden) {
    fail("resetMobileDetailState should keep metrics visible");
  }
  if (mobile.sandbox.extraScrollY !== 0) fail("reset should clear saved scroll");
  pass("activity reset keeps metrics visible and clears saved scroll");

  mobile.sandbox.syncPagerPlacement();
  if (mobile.pager.parent !== mobile.sheet) fail("mobile pager should move to the sheet (outside the scroller)");
  pass("mobile pager placement is the sheet footer");

  const desk = runUnit(script, false);
  desk.sandbox.setExtraOpen(true, { saveScroll: true, scroll: true, focus: false });
  if (desk.dialog.classList.contains("is-extra-open")) fail("desktop must not use is-extra-open");
  if (desk.extra.hidden) fail("desktop extra must stay visible");
  if (!desk.moreEnd.hidden) fail("desktop must not show the end collapse button");
  if (desk.moreLabel.textContent !== "查看详情") fail("desktop more-button copy unused / hidden");
  desk.sandbox.syncPagerPlacement();
  if (desk.pager.parent !== desk.meta) fail("desktop pager must stay in the meta column");
  pass("desktop visual/interaction chrome unchanged");

  mobile.sandbox.setExtraOpen(true, { saveScroll: false, scroll: false, focus: false });
  mobile.sandbox.syncMobileExtraChrome();
  if (!mobile.dialog.classList.contains("is-extra-open") || mobile.extra.hidden) {
    fail("staying on a compact viewport must not drop expanded state");
  }
  pass("compact viewport resize keeps expanded state");

  const short = runUnit(script, { short: true });
  if (!short.sandbox.isMobileDetail()) fail("wide but height <=600 must use mobile detail");
  short.sandbox.setExtraOpen(true, { saveScroll: false, scroll: false, focus: false });
  if (!short.dialog.classList.contains("is-extra-open") || short.extra.hidden) {
    fail("short viewport must show metrics like other compact views");
  }
  short.sandbox.syncPagerPlacement();
  if (short.pager.parent !== short.sheet) fail("short viewport pager should sit on the sheet footer");
  pass("short wide viewport uses compact mobile detail");
}

function rotationBehavior(script) {
  const t = runUnit(script, { mobile: true, queued: true });
  const pad = () => parseFloat(t.layout.style["--wk-viz-pad-top"] || 0);
  const resize = (width, height) => {
    t.viewport.width = width;
    t.viewport.height = height;
    t.body._rect = { top: 0, bottom: height - 180, height: height - 180 };
    t.sandbox.syncMobileExtraChrome(true);
    t.flush();
  };
  resize(390, 800);
  if (pad() !== 0) fail("portrait should top-align the stack, not center it");
  t.sandbox.setExtraOpen(true, { saveScroll: true, scroll: false, focus: false });
  t.flush();
  t.sandbox.syncMobileVizCenter();
  if (pad() !== 0) fail("expand must keep the stack top-aligned");
  for (const [width, height] of [[800, 390], [873, 393]]) {
    resize(width, height);
    if (!t.sandbox.isMobileDetail() || !t.dialog.classList.contains("is-extra-open") || t.extra.hidden) {
      fail("rotation must preserve compact expanded state at " + width + "x" + height);
    }
    if (pad() !== 0) fail("expanded landscape must discard portrait padding");
    t.sandbox.setExtraOpen(false, { scroll: true, focus: true });
    t.flush();
    if (t.extra.hidden || t.extra.inert || !t.dialog.classList.contains("is-extra-open")) {
      fail("landscape must keep metrics visible at " + width + "x" + height);
    }
  }
  resize(390, 800);
  t.sandbox.setExtraOpen(false, { scroll: true, focus: true });
  t.flush();
  if (pad() !== 0) fail("back to portrait must stay top-aligned");
  t.sandbox.hrSeries = [];
  const draws = t.sandbox._hrDrawn;
  t.sandbox.setExtraOpen(true, { scroll: false, focus: false });
  t.flush();
  if (t.sandbox.isHrScrubInteractive() || t.sandbox._hrDrawn !== draws) fail("no-HR activity must not draw or scrub");
  resize(1280, 800);
  if (t.sandbox.isMobileDetail() || t.extra.hidden || t.extra.inert || t.pager.parent !== t.meta || pad() !== 0) {
    fail("wide/tall desktop must restore visible extra and column pager");
  }
  for (const [width, height, compact] of [[768, 800, true], [769, 600, true], [769, 601, false], [1280, 800, false]]) {
    resize(width, height);
    if (t.sandbox.isMobileDetail() !== compact) fail("breakpoint boundary " + width + "x" + height);
  }
  resize(390, 500);
  if (pad() !== 0) fail("overflow portrait must top-align instead of adding padding");
  pass("queued-rAF geometry: portrait top-align, metrics stay visible on rotate, desktop restore, no HR, exact boundaries");
}

function legendBehavior(script) {
  const t = runUnit(script, true);
  const legend = makeEl("", { class: "wk-legend" });
  const clock = makeEl("", {});
  const context = {
    legendEl: legend, clockPanel: clock,
    isMobileDetail: () => t.sandbox.isMobileDetail(),
    legendHover: null, legendFocus: null,
    renderLegendSlot() {},
  };
  for (const name of ["syncLegendVis", "isLegendVisible"]) {
    const fn = script.match(new RegExp("  function " + name + "\\([\\s\\S]*?\\n  }"));
    if (!fn) fail("missing actual legend helper " + name);
    vm.runInNewContext(fn[0], context);
  }
  context.syncLegendVis(true);
  if (!legend.hidden || legend.classList.contains("is-reserved") || context.isLegendVisible()) {
    fail("compact trail must hide the legend without reserving a gap");
  }
  context.syncLegendVis(false);
  if (!context.isLegendVisible() || legend.getAttribute("aria-hidden") != null) fail("Clock/no-trail legend should be accessible");
  clock.hidden = true;
  if (context.isLegendVisible()) fail("hidden Clock panel must not expose legend interactions");
  t.viewport.width = 1280;
  t.viewport.height = 800;
  context.syncLegendVis(true);
  if (!legend.hidden || legend.classList.contains("is-reserved")) fail("desktop trail should hide legend without reserved mobile slot");
  pass("actual legend helpers: compact trail hidden with no reserved gap, Clock and no-trail visible, hidden panel inert, desktop restored");
}

function main() {
  console.log("Mobile detail extra — NOT a real browser/phone test");
  const html = read(PARTIAL);
  const script = read(SCRIPT);
  const scss = read(SCSS);
  staticChecks(html, script, scss);
  const syn = spawnSync(process.execPath, ["--check"], { input: script, encoding: "utf8" });
  if (syn.status !== 0) fail("node --check failed: " + syn.stderr);
  pass("extracted script node --check");
  behavior(script);
  rotationBehavior(script);
  legendBehavior(script);
  if (process.exitCode) fail("had failures");
  console.log("ALL PASS — mobile metrics visible + desktop unchanged + no flex-chain");
}

main();
