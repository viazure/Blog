#!/usr/bin/env node
/**
 * Session Clock tip-sheet regression guard.
 *
 * Catches the a98a750-class failure: editing TIP_COPY accidentally deletes
 * tipSheet/tipTitle/tipBody DOM bindings so every detail click throws
 * ReferenceError and the page looks "dead" on mobile.
 *
 * This is NOT a real browser / phone test. It only:
 *   1) static-checks the Hugo partial (markup + binding placement)
 *   2) syntax-checks the extracted component script (Hugo stubs replaced)
 *   3) runs the script in node:vm with a minimal DOM mock
 *   4) negative-controls that removing the three bindings fails the suite
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

function extractScript(html) {
  const m = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*$/);
  if (!m) throw new Error("component <script> not found in partial");
  // Stub Hugo expressions so the extracted JS is valid outside Hugo.
  return m[1].replace(/\{\{[\s\S]*?\}\}/g, '"/trails.json"');
}

function assertStatic(html, script) {
  const requiredMarkup = [
    'id="wk-tip-sheet"',
    'id="wk-tip-sheet-title"',
    "data-wk-tip-body",
    "data-wk-tip-close",
    'data-wk-tip="sclock"',
    'id="wk-detail"',
    'data-viz="map"',
    'data-viz="clock"',
  ];
  for (const needle of requiredMarkup) {
    if (!html.includes(needle)) throw new Error("markup missing " + needle);
  }
  pass("partial markup has tip sheet + detail shell selectors");

  const decls = script.match(/var tipSheet = document\.getElementById\("wk-tip-sheet"\);/g) || [];
  if (decls.length !== 1) {
    throw new Error("expected exactly one tipSheet binding, got " + decls.length);
  }
  for (const name of ["tipTitle", "tipBody", "legendHead"]) {
    const re = new RegExp("var " + name + " = ");
    if (!re.test(script)) throw new Error("missing binding " + name);
  }
  pass("tipSheet/tipTitle/tipBody/legendHead bindings present once");

  const bindAt = script.indexOf('var tipSheet = document.getElementById("wk-tip-sheet")');
  const copyAt = script.indexOf("var TIP_COPY =");
  const pagerAt = script.indexOf('var pager = dialog.querySelector(".wk-pager")');
  if (bindAt < 0 || copyAt < 0 || pagerAt < 0) {
    throw new Error("could not locate tipSheet / TIP_COPY / pager anchors");
  }
  if (!(pagerAt < bindAt && bindAt < copyAt)) {
    throw new Error(
      "tip bindings must sit with top DOM queries (after pager, before TIP_COPY); " +
        JSON.stringify({ pagerAt, bindAt, copyAt })
    );
  }
  // Keep bindings near the top shell queries — far from TIP_COPY edit surface.
  const head = script.slice(0, bindAt);
  const earlyDialog = head.indexOf('var dialog = document.getElementById("wk-detail")');
  if (earlyDialog < 0 || bindAt - earlyDialog > 1200) {
    throw new Error("tip bindings drifted too far from dialog shell queries");
  }
  pass("tip bindings colocated with top DOM queries, before TIP_COPY");

  if (!/function openTipSheet\(key\)/.test(script)) throw new Error("openTipSheet missing");
  if (!/function closeTipSheet\(/.test(script)) throw new Error("closeTipSheet missing");
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

function fireClick(listeners, selector, attrs) {
  const target = {
    attrs: Object.assign(Object.create(null), attrs || {}),
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    closest(sel) { return sel === selector ? target : null; },
    classList: { contains() { return false; } },
  };
  const ev = {
    target,
    preventDefault() {},
    stopPropagation() {},
  };
  for (const fn of listeners.click || []) fn(ev);
  return target;
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

  fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "sclock" });
  const sheet = mock.el("wk-tip-sheet");
  const title = mock.el("wk-tip-sheet #wk-tip-sheet-title");
  const body = mock.el("wk-tip-sheet [data-wk-tip-body]");
  if (!sheet.open) throw new Error("ⓘ click did not open tip sheet");
  if (title.textContent !== "图例") throw new Error("unexpected tip title: " + title.textContent);
  if (!String(body.textContent).includes("外圈")) throw new Error("tip body missing expected copy");
  pass("vm ⓘ click opens tip sheet with TIP_COPY");

  fireClick(mock.listeners, "[data-wk-tip-close]");
  if (sheet.open) throw new Error("tip close did not close sheet");
  pass("vm tip close");

  fireClick(mock.listeners, ".wk-viz-tab", { "data-viz": "map" });
  if (mock.el('wk-detail [data-panel="map"]').hidden !== false) throw new Error("map tab failed");
  if (mock.el('wk-detail [data-panel="clock"]').hidden !== true) throw new Error("clock hide failed");
  fireClick(mock.listeners, ".wk-viz-tab", { "data-viz": "clock" });
  if (mock.el('wk-detail [data-panel="clock"]').hidden !== false) throw new Error("clock tab failed");
  pass("vm Map/Clock tab toggles panel.hidden");

  fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "moving" });
  if (!sheet.open) throw new Error("metric tip did not open");
  mock.listeners.keydown[0]({ key: "Escape" });
  if (sheet.open) throw new Error("Escape did not close tip sheet");
  pass("vm metric tip + Escape close");

  // Card path: ensure click routing does not throw ReferenceError on tip bindings.
  // Full openDetail / SVG / shard fetch is out of scope for this mock.
  let cardErr = null;
  try {
    fireClick(mock.listeners, ".run-card[data-idx]", { "data-idx": "1" });
  } catch (e) {
    cardErr = e;
  }
  if (cardErr && /tipSheet|tipTitle|tipBody/.test(String(cardErr.message || cardErr))) {
    throw cardErr;
  }
  pass("vm card click path does not hit tip binding ReferenceError (openDetail/SVG not asserted)");
}

function stripTipBindings(script) {
  return script
    .replace(/^[ \t]*var tipSheet = document\.getElementById\("wk-tip-sheet"\);\r?\n/m, "")
    .replace(/^[ \t]*var tipTitle = tipSheet \? tipSheet\.querySelector\("#wk-tip-sheet-title"\) : null;\r?\n/m, "")
    .replace(/^[ \t]*var tipBody = tipSheet \? tipSheet\.querySelector\("\[data-wk-tip-body\]"\) : null;\r?\n/m, "");
}

function assertNegative(script) {
  const broken = stripTipBindings(script);
  const decls = broken.match(/var tipSheet = document\.getElementById\("wk-tip-sheet"\);/g) || [];
  if (decls.length !== 0) throw new Error("negative control failed to strip tipSheet");
  if (/var tipTitle = /.test(broken) && /tipSheet \? tipSheet\.querySelector\("#wk-tip-sheet-title"\)/.test(broken)) {
    throw new Error("negative control failed to strip tipTitle");
  }
  // The suite's static invariant: exactly one tipSheet binding colocated at top.
  let rejected = false;
  try {
    if (decls.length !== 1) throw new Error("expected exactly one tipSheet binding, got " + decls.length);
  } catch (e) {
    rejected = /exactly one tipSheet binding/.test(String(e.message || e));
  }
  if (!rejected) throw new Error("negative control: static check should reject missing tipSheet");
  pass("negative control: static check rejects stripped tipSheet bindings");

  const mock = makeDomMock();
  runScript(broken, mock);
  let threw = null;
  try {
    fireClick(mock.listeners, "[data-wk-tip]", { "data-wk-tip": "sclock" });
  } catch (e) {
    threw = e;
  }
  if (!threw || threw.name !== "ReferenceError" || !/tipSheet/.test(String(threw.message))) {
    throw new Error("negative control expected ReferenceError tipSheet, got " + threw);
  }
  pass("negative control: vm tip click throws ReferenceError: tipSheet is not defined");
}

function main() {
  console.log("session-clock tip guard — NOT a real browser/phone test");
  const html = readPartial();
  const script = extractScript(html);
  assertStatic(html, script);
  syntaxCheck(script, "extracted component script");
  assertVmHappy(script);
  assertNegative(script);
  if (process.exitCode) {
    console.error("tip guard FAILED");
    process.exit(process.exitCode);
  }
  console.log("ALL PASS — safe against TIP_COPY-edit deleting tip DOM bindings");
}

main();
