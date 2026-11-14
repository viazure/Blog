#!/usr/bin/env node
/**
 * Session Clock in-page tip regression guard.
 *
 * Catches failures where editing TIP_COPY or metric tips accidentally
 * reintroduces a #wk-tip-sheet dialog, drops .wk-info-tip markup, or
 * breaks click-to-toggle .is-open so detail tips stop working.
 *
 * This is NOT a real browser / phone test. It only:
 *   1) static-checks the Hugo partial (markup + helpers, no tip-sheet)
 *   2) syntax-checks the extracted component script (Hugo stubs replaced)
 *   3) runs the script in node:vm with a minimal DOM mock
 *   4) negative-controls that a leftover tipSheet dependency or a
 *      stripped is-open toggle fails the suite
 *
 * Usage (repo root): node scripts/check_session_clock_tip_guard.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PARTIAL = path.join(ROOT, "layouts", "_partials", "session-clock-script.html");
const SCRIPT = path.join(ROOT, "assets", "js", "session-clock.js");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log("PASS:", msg);
}

function readPartial() {
  if (!fs.existsSync(PARTIAL)) fail("missing " + PARTIAL);
  return fs.readFileSync(PARTIAL, "utf8");
}

function readScript() {
  if (!fs.existsSync(SCRIPT)) fail("missing " + SCRIPT);
  return fs.readFileSync(SCRIPT, "utf8");
}

function assertStatic(html, script) {
  const src = html + "\n" + script;
  const requiredMarkup = [
    'class="wk-info-tip"',
    'class="wk-metrics"',
    'class="wk-detail-meta-scroll"',
    "data-wk-legend-slot",
    'id="wk-detail"',
    'data-viz="map"',
    'data-viz="clock"',
    "data-wk-split-link",
    "data-running-page",
    "js/session-clock.js",
  ];
  for (const needle of requiredMarkup) {
    if (!src.includes(needle)) throw new Error("markup missing " + needle);
  }
  const forbidden = [
    "wk-tip-sheet",
    "data-wk-tip-body",
    "data-wk-tip-close",
    "tipSheet",
    "tipTitle",
    "tipBody",
    "showModal()",
  ];
  for (const needle of forbidden) {
    // showModal() is still used for the detail dialog; only reject tip-sheet usage later.
    if (needle === "showModal()") continue;
    if (html.includes(needle) || script.includes(needle)) {
      throw new Error("leftover tip-sheet dependency: " + needle);
    }
  }
  if (/\btipSheet\b/.test(script) || /\btipTitle\b/.test(script) || /\btipBody\b/.test(script)) {
    throw new Error("script still references tip-sheet bindings");
  }
  pass("partial has in-page tips and no #wk-tip-sheet");

  const scrollAt = html.indexOf('class="wk-detail-meta-scroll"');
  const metricsAt = html.indexOf('class="wk-metrics"');
  const hrAt = html.indexOf('id="wk-hr-scrub"');
  if (scrollAt < 0 || metricsAt < 0 || hrAt < 0 || !(scrollAt < metricsAt && metricsAt < hrAt)) {
    throw new Error("wk-metrics must sit inside .wk-detail-meta-scroll with the HR trend");
  }
  pass("metrics sit inside the meta scroller with HR");

  const copyAt = script.indexOf("var TIP_COPY =");
  if (copyAt < 0) throw new Error("TIP_COPY missing");
  const copyMatch = script.match(/var TIP_COPY = \{([\s\S]*?)\n  \};/);
  if (!copyMatch) throw new Error("could not parse TIP_COPY");
  const keys = [...copyMatch[1].matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  if (keys.join(",") !== "kcal") {
    throw new Error("TIP_COPY keys should be only kcal; got " + keys.join(","));
  }
  if (!copyMatch[1].includes("估算消耗，非实测。")) throw new Error("kcal tip copy changed");
  if (copyMatch[1].includes("moving") || copyMatch[1].includes("实际移动时长") || copyMatch[1].includes("手表")) {
    throw new Error("用时 tip / 手表 wording should be removed from TIP_COPY");
  }
  pass("TIP_COPY is only 能耗");

  if (/metricHtml\("用时"[^;]*,\s*["']moving["']\s*\)/.test(script)) {
    throw new Error("用时 should not have a tip key");
  }
  if (!/metricHtml\("能耗"[^;]*,\s*["']kcal["']\s*\)/.test(script)) {
    throw new Error("能耗 should keep a kcal tip key");
  }
  if (/metricHtml\("平均心率"[^;]*,\s*["'][^"']+["']\s*\)/.test(script)) {
    throw new Error("平均心率 should not have a tip key");
  }
  if (/metricHtml\("最大心率"[^;]*,\s*["'][^"']+["']\s*\)/.test(script)) {
    throw new Error("最大心率 should not have a tip key");
  }
  if (!/wk-info-tip/.test(script) || !/function metricHtml\(label, value, unit, tipKey\)/.test(script)) {
    throw new Error("metricHtml must render .wk-info-tip");
  }
  pass("用时 / HR metrics have no ⓘ; only 能耗 keeps a tip");

  if (!/function openTipSheet\(key\)/.test(script)) throw new Error("openTipSheet missing");
  if (!/function closeTipSheet\(/.test(script)) throw new Error("closeTipSheet missing");
  if (!/classList\.add\("is-open"\)/.test(script)) throw new Error("openTipSheet must toggle .is-open");
  if (!/document\.addEventListener\("click"/.test(script)) throw new Error("click listener missing");
  if (!/document\.addEventListener\("keydown"/.test(script)) throw new Error("keydown listener missing");
  pass("open/close tip helpers and click/keydown listeners present");
}

function syntaxCheck(script, label) {
  const tmp = path.join(ROOT, "scripts", ".session-clock-tip-guard.tmp.js");
  fs.writeFileSync(tmp, script);
  try {
    const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error((label || "syntax") + " failed:\n" + (r.stderr || r.stdout || ""));
    }
    pass((label || "extracted script") + " node --check");
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function makeDomMock() {
  const cache = new Map();
  const listeners = Object.create(null);

  function el(key) {
    if (cache.has(key)) return cache.get(key);
    const node = {
      key,
      style: {},
      hidden: false,
      open: false,
      textContent: "",
      innerHTML: "",
      attrs: Object.create(null),
      classList: {
        contains() { return false; },
        toggle() {},
        remove() {},
        add() {},
      },
      querySelector(sel) { return el(key + " " + sel); },
      querySelectorAll() { return []; },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      contains() { return true; },
      closest() { return null; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      removeChild() {},
      appendChild() {},
      firstChild: null,
    };
    cache.set(key, node);
    return node;
  }

  const document = {
    readyState: "complete",
    documentElement: el("html"),
    getElementById(id) { return el(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
  };

  const window = {
    matchMedia() { return { matches: true }; },
  };

  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    fetch() {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ points: {} }) });
    },
    getComputedStyle() {
      return { getPropertyValue() { return ""; } };
    },
  };

  return { ctx, listeners, el, document, window };
}

function runScript(script, mock) {
  vm.runInNewContext(script, mock.ctx, { filename: "session-clock-script.js" });
}

function fireClick(listeners, selector, attrs, existing) {
  const target = existing || {
    attrs: Object.assign(Object.create(null), attrs || {}),
    _selector: selector,
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    closest(sel) { return sel === this._selector ? target : null; },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
  };
  const ev = {
    target,
    preventDefault() {},
    stopPropagation() {},
  };
  for (const fn of listeners.click || []) fn(ev);
  return target;
}

function tipIsOpen(btn) {
  return !!(btn && btn.classList.contains("is-open") && btn.getAttribute("aria-expanded") === "true");
}

function assertVmHappy(script) {
  const mock = makeDomMock();
  runScript(script, mock);
  if (!(mock.listeners.click && mock.listeners.click.length === 1)) {
    throw new Error("click listener not bound");
  }
  if (!(mock.listeners.keydown && mock.listeners.keydown.length === 1)) {
    throw new Error("keydown listener not bound");
  }
  if (!(mock.listeners["workouts:year-loaded"] && mock.listeners["workouts:year-loaded"].length === 1)) {
    throw new Error("workouts:year-loaded listener not bound");
  }
  if (typeof mock.window.__wkIndexItems !== "function") {
    throw new Error("__wkIndexItems not exported");
  }
  pass("vm init binds click/keydown/year-loaded (minimal DOM mock)");

  fireClick(mock.listeners, ".wk-legend-key[data-layer]", { "data-layer": "outer" });
  pass("vm legend key does not open a metric tip");

  const tipBtn = fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "kcal" });
  if (!tipIsOpen(tipBtn)) throw new Error("metric ? click did not open floating tip");
  pass("vm metric ? click opens in-page tip via .is-open");

  fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "kcal" }, tipBtn);
  if (tipIsOpen(tipBtn)) throw new Error("second click did not close floating tip");
  pass("vm metric tip toggles closed on second click");

  fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "kcal" }, tipBtn);
  if (!tipIsOpen(tipBtn)) throw new Error("metric tip did not reopen");
  fireClick(mock.listeners, ".wk-viz-tab", { "data-viz": "map" });
  if (tipIsOpen(tipBtn)) throw new Error("map tab did not dismiss floating tip");
  if (mock.el('wk-detail [data-panel="map"]').hidden !== false) throw new Error("map tab failed");
  if (mock.el('wk-detail [data-panel="clock"]').hidden !== true) throw new Error("clock hide failed");
  fireClick(mock.listeners, ".wk-viz-tab", { "data-viz": "clock" });
  if (mock.el('wk-detail [data-panel="clock"]').hidden !== false) throw new Error("clock tab failed");
  pass("vm Map/Clock tab toggles panel.hidden and dismisses tip");

  fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "kcal" }, tipBtn);
  if (!tipIsOpen(tipBtn)) throw new Error("metric tip did not open");
  mock.listeners.keydown[0]({ key: "Escape" });
  if (tipIsOpen(tipBtn)) throw new Error("Escape did not close floating tip");
  pass("vm metric tip + Escape close");

  fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "kcal" }, tipBtn);
  fireClick(mock.listeners, ".wk-detail-title");
  if (tipIsOpen(tipBtn)) throw new Error("outside click did not dismiss floating tip");
  pass("vm outside click dismisses floating tip");

  // Card path: ensure click routing does not throw on tip helpers.
  // Full openDetail / SVG / shard fetch is out of scope for this mock.
  let cardErr = null;
  try {
    fireClick(mock.listeners, ".run-card[data-idx]", { "data-idx": "1" });
  } catch (e) {
    cardErr = e;
  }
  if (cardErr && /tipSheet|tipTitle|tipBody|openTipSheet/.test(String(cardErr.message || cardErr))) {
    throw cardErr;
  }
  pass("vm card click path does not hit tip helper ReferenceError (openDetail/SVG not asserted)");
}

function assertNegative(html, script) {
  const polluted = script.replace(
    /if \(!copy\) return;/,
    "if (!copy || !tipSheet) return;"
  );
  if (polluted === script) throw new Error("negative control failed to inject tipSheet guard");
  let rejected = false;
  try {
    assertStatic(html, polluted);
  } catch (e) {
    rejected = /tip-sheet|tipSheet/.test(String(e.message || e));
  }
  if (!rejected) throw new Error("negative control: static check should reject tipSheet dependency");
  pass("negative control: static check rejects leftover tipSheet dependency");

  const stripped = script.replace('btn.classList.add("is-open");', "");
  if (stripped === script) throw new Error("negative control failed to strip is-open toggle");
  const mock = makeDomMock();
  runScript(stripped, mock);
  const tipBtn = fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "kcal" });
  if (tipIsOpen(tipBtn)) throw new Error("negative control: stripped is-open should not open the tip");
  pass("negative control: vm tip click fails when .is-open toggle is stripped");
}

function main() {
  console.log("session-clock tip guard — NOT a real browser/phone test");
  const html = readPartial();
  const script = readScript();
  assertStatic(html, script);
  syntaxCheck(script, "extracted component script");
  assertVmHappy(script);
  assertNegative(html, script);
  if (process.exitCode) {
    console.error("tip guard FAILED");
    process.exit(process.exitCode);
  }
  console.log("ALL PASS — in-page .wk-info-tip click/hover tips have no #wk-tip-sheet dependency");
}

main();
