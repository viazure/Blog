(function () {
  var dialog = document.getElementById("wk-detail");
  if (!dialog) return;
  var cfg = dialog.dataset || {};
  var DETAIL_TRAIL_URL = cfg.trailsDetail || "";
  var TRAIL_URL = cfg.trails || "";
  var YEAR_BASE = cfg.yearBase || "";
  var RUNNING_PAGE = String(cfg.runningPage || "https://run.viazure.cc").replace(/\/$/, "");
  var itemsByIdx = Object.create(null);
  var trails = null;
  var trailSize = 400;
  var trailPromise = null;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var titleEl = dialog.querySelector("#wk-detail-title");
  var whenEl = dialog.querySelector(".wk-detail-when");
  var sportName = dialog.querySelector(".wk-sport-name");
  var sportPill = dialog.querySelector(".wk-sport-pill");
  var metricsEl = dialog.querySelector(".wk-metrics");
  var legendEl = dialog.querySelector(".wk-legend");
  var legendSlot = dialog.querySelector("[data-wk-legend-slot]");
  var toolsEl = dialog.querySelector(".wk-viz-tools");
  var mapPanel = dialog.querySelector('[data-panel="map"]');
  var clockPanel = dialog.querySelector('[data-panel="clock"]');
  var mapSvg = dialog.querySelector("svg.wk-map");
  var clockSvg = dialog.querySelector("svg.wk-sclock");
  var pager = dialog.querySelector(".wk-pager");
  var activeTipBtn = null;
  var hrScrubEl = dialog.querySelector("[data-wk-hr-scrub]");
  var hrToggleBtn = hrScrubEl ? hrScrubEl.querySelector("[data-wk-hr-toggle]") : null;
  var hrTimeEl = hrScrubEl ? hrScrubEl.querySelector("[data-wk-hr-time]") : null;
  var hrBpmEl = hrScrubEl ? hrScrubEl.querySelector("[data-wk-hr-bpm]") : null;
  var hrWrapEl = hrScrubEl ? hrScrubEl.querySelector("[data-wk-hr-wrap]") : null;
  var hrCanvas = hrScrubEl ? hrScrubEl.querySelector("[data-wk-hr-canvas]") : null;
  var hrAxisStart = hrScrubEl ? hrScrubEl.querySelector("[data-wk-hr-axis-start]") : null;
  var hrAxisMid = hrScrubEl ? hrScrubEl.querySelector("[data-wk-hr-axis-mid]") : null;
  var hrAxisEnd = hrScrubEl ? hrScrubEl.querySelector("[data-wk-hr-axis-end]") : null;
  var hrSeries = [];
  var hrMovingSec = 0;
  var hrStartMin = null;
  var hrIdx = 0;
  var hrDragging = false;

  var currentIdx = null;
  var currentList = [];
  var legendFocus = null;
  var legendHover = null;
  var currentZoneSession = {};
  var LEGEND_LABEL = { outer: "外圈", inner: "中圈", core: "核心" };
  var OUTER_LEGEND_COPY = "一圈代表整场训练，从正上方开始，沿顺时针方向展开。外圈的每一格对应一段时间，高度和亮度随心率区间的升高而变化。";
  var ZONE_COPY = {
    title: "心率区间",
    titleEstimated: "心率区间（估算）",
    device: "按设备记录的心率区间。",
    lthr: "按乳酸阈心率重新划分。",
    maxhr_age: "按年龄估算的心率区间，非设备原始数据。",
    noBaseline: "信息不足，无法计算心率区间。",
    noBaselineHint: "需要设备记录的心率数据，或提供乳酸阈心率、出生年月来估算。",
    noHrData: "这次活动没有记录到心率。"
  };
  var legendCopy = {
    outer: OUTER_LEGEND_COPY,
    inner: "同一圈上的心率，越高越靠外。",
    core: "不满 1 小时是一颗实心圆点；每满 1 小时多一环。"
  };
  // Remember viz tab across detail pager / reopen (map|clock); null = default by has_trail
  var preferredViz = null;

  function themeTok(name, fallback) {
    try {
      var v = getComputedStyle(dialog).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function isDarkTheme() {
    var root = document.documentElement;
    if (root.classList.contains("dark")) return true;
    if (root.classList.contains("light")) return false;
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch (e) {
      return false;
    }
  }

  function accentFallback() {
    return themeTok("--wk-accent-fallback", "");
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dash(v) {
    return v == null || v === "" || v === 0 || v === "0" ? "—" : String(v);
  }

  function elapsedLabel(moving) {
    var s = Math.max(0, Math.floor(Number(moving) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m;
    return "0:" + (m < 10 ? "0" : "") + m;
  }

  function sessionRichness(s) {
    if (!s) return 0;
    var n = 0;
    if (s.bars && s.bars.length) n += 2;
    if (s.hr && s.hr.length) n += 1;
    if (s.has_session || s.moving) n += 0.1;
    return n;
  }

  function indexItem(c) {
    if (!c || c.idx == null) return;
    var key = String(c.idx);
    var prev = itemsByIdx[key];
    if (!prev) {
      itemsByIdx[key] = c;
      return;
    }
    var next = Object.assign({}, prev, c);
    if (sessionRichness(prev.session) > sessionRichness(c.session)) {
      next.session = prev.session;
    }
    itemsByIdx[key] = next;
  }

  function indexMany(items) {
    (items || []).forEach(indexItem);
  }

  function visibleCards() {
    var panel = document.querySelector(".act-switcher .sw-panel:not([hidden])");
    var checked = document.querySelector('.act-switcher input[name="actyear"]:checked');
    if (checked) {
      var yi = checked.getAttribute("data-yi");
      panel = document.querySelector(".act-switcher .sw-panel-" + yi);
    }
    if (!panel) return [];
    return [].slice.call(panel.querySelectorAll(".run-card[data-idx]"));
  }

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function accentOf(cardOrName) {
    if (cardOrName && cardOrName.style) {
      var a = getComputedStyle(cardOrName).getPropertyValue("--workout-accent").trim();
      if (a) return a;
    }
    return accentFallback();
  }

  function canHoverLegend() {
    try {
      return !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    } catch (e) { return false; }
  }

  function isFinePointer(ev) {
    if (!canHoverLegend()) return false;
    var t = ev && ev.pointerType;
    return !t || t === "mouse" || t === "pen";
  }

  function isLegendVisible() {
    return !!(legendEl && !legendEl.hidden && clockPanel && !clockPanel.hidden);
  }

  function legendEffective() {
    return legendHover || legendFocus;
  }

  function applyLegendFocus(svg) {
    if (!svg) return;
    var focus = legendEffective();
    ["outer", "inner", "core"].forEach(function (layer) {
      var g = svg.querySelector(".wk-layer-" + layer);
      if (!g) return;
      if (!focus) {
        g.classList.remove("is-dim", "is-focus");
      } else if (focus === layer) {
        g.classList.add("is-focus");
        g.classList.remove("is-dim");
      } else {
        g.classList.add("is-dim");
        g.classList.remove("is-focus");
      }
    });
    if (!legendEl) return;
    legendEl.querySelectorAll(".wk-legend-key[data-layer]").forEach(function (row) {
      var on = !!(focus && row.getAttribute("data-layer") === focus);
      row.classList.toggle("is-on", on);
      row.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function zoneLegendHtml(session) {
    session = session || {};
    var source = session.source || "";
    var reason = session.empty_reason || "";
    var title = session.estimated ? ZONE_COPY.titleEstimated : ZONE_COPY.title;
    if (reason === "no_baseline") {
      return '<div class="wk-legend-line"><strong>' + esc(ZONE_COPY.title) + "</strong>" +
        esc(ZONE_COPY.noBaseline) + "</div>" +
        '<div class="wk-legend-hint">' + esc(ZONE_COPY.noBaselineHint) + "</div>";
    }
    if (reason === "no_hr_data") {
      return '<div class="wk-legend-line"><strong>' + esc(ZONE_COPY.title) + "</strong>" +
        esc(ZONE_COPY.noHrData) + "</div>";
    }
    if (source === "device") {
      return '<div class="wk-legend-line"><strong>' + esc(title) + "</strong>" +
        esc(ZONE_COPY.device) + "</div>";
    }
    if (source === "lthr") {
      return '<div class="wk-legend-line"><strong>' + esc(title) + "</strong>" +
        esc(ZONE_COPY.lthr) + "</div>";
    }
    if (source === "maxhr_age") {
      return '<div class="wk-legend-line"><strong>' + esc(ZONE_COPY.titleEstimated) + "</strong>" +
        esc(ZONE_COPY.maxhr_age) + "</div>";
    }
    return "";
  }

  function renderLegendSlot() {
    if (!legendSlot) return;
    var html = "";
    var layer = legendHover || legendFocus;
    if (layer) {
      html = '<div class="wk-legend-line"><strong>' + esc(LEGEND_LABEL[layer]) + "</strong>" +
        esc(legendCopy[layer] || "") + "</div>";
    } else {
      html = zoneLegendHtml(currentZoneSession) ||
        '<div class="wk-legend-hint">点按图标查看说明</div>';
    }
    legendSlot.innerHTML = html;
    legendSlot.classList.toggle("is-filled", !!layer);
  }

  function refreshLegendChrome() {
    applyLegendFocus(clockSvg);
    renderLegendSlot();
  }

  function clearLegendExplain() {
    var had = !!(legendHover || legendFocus);
    if (!had) return false;
    legendHover = null;
    legendFocus = null;
    refreshLegendChrome();
    return true;
  }

  function pinLegendLayer(layer) {
    if (!layer) return;
    if (legendFocus === layer) {
      legendFocus = null;
    } else {
      legendFocus = layer;
    }
    legendHover = null;
    refreshLegendChrome();
  }

  function legendLayerFromPoint(clientX, clientY) {
    if (!clockSvg) return null;
    var rect = clockSvg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var dx = clientX - (rect.left + rect.width / 2);
    var dy = clientY - (rect.top + rect.height / 2);
    var dist = Math.sqrt(dx * dx + dy * dy);
    var scale = rect.width / 400;
    // Core hit at least 44px diameter; stay inside the inner floor when the clock is large.
    var coreR = Math.max(22, 48 * scale);
    var innerOuter = 115 * scale;
    var outerR = 190 * scale;
    if (dist <= coreR) return "core";
    if (dist <= innerOuter) return "inner";
    if (dist <= outerR) return "outer";
    return null;
  }

  /** Polar Session Clock (geekplux-aligned):
   * Outer zone bars + inner HR area/line map the WHOLE session onto 360° (always full ring).
   * Core: full-circle seed when <1h; one growth ring per completed hour when ≥1h (geekplux pc()).
   * Whole graphic draws in sync.
   */
  function drawSessionClock(svg, session, accent, mini, drawMs) {
    clearSvg(svg);
    session = session || {};
    try { svg.removeAttribute("data-sweep"); svg.removeAttribute("data-moving"); } catch (e) {}
    var cx = 200, cy = 200;
    var bars = session.bars || [];
    var hr = session.hr || [];
    function resampleArr(arr, n) {
      if (!arr || !arr.length) return [];
      if (arr.length === n) return arr.slice();
      if (arr.length === 1) {
        var one = [];
        for (var ri = 0; ri < n; ri++) one.push(arr[0]);
        return one;
      }
      var out = [];
      var last = arr.length - 1;
      for (var ri = 0; ri < n; ri++) {
        var pos = ri * last / (n - 1);
        var lo = Math.floor(pos);
        var hi = Math.min(lo + 1, last);
        var tt = pos - lo;
        out.push(Number(arr[lo]) * (1 - tt) + Number(arr[hi]) * tt);
      }
      return out;
    }
    // Prefer session.moving; fall back to top-level aliases for core hour math.
    var moving = Number(session.moving);
    if (!isFinite(moving) || moving <= 0) moving = Number(session.moving_time) || 0;
    if (!isFinite(moving) || moving <= 0) moving = 0;
    var hours = Math.floor(moving / 3600);
    var soft = accent || accentFallback();
    var ink = soft;
    var DRAW_MS = (drawMs > 0) ? drawMs : 900;

    function rad(d) { return d * Math.PI / 180; }
    function pt(r, a) {
      return [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
    }

    // Outer + inner always span a full lap (session → 360°). Core is seed disk or hour rings — never a duration arc.
    var fullDeg = 360;
    var aStart = -90;
    try {
      svg.setAttribute("data-sweep", hours >= 1 ? "360" : "seed");
      svg.setAttribute("data-moving", String(Math.round(moving)));
      svg.setAttribute("data-core", hours >= 1 ? ("rings-" + hours) : "seed");
    } catch (e) {}

    var defs = ns("defs");
    var gid = mini ? "scGlowMini" : "scGlow";
    var grad = ns("radialGradient");
    grad.setAttribute("id", gid);
    grad.setAttribute("cx", "50%"); grad.setAttribute("cy", "50%"); grad.setAttribute("r", "50%");
    [["0%", "0.10"], ["55%", "0.035"], ["100%", "0"]].forEach(function (pair) {
      var stop = ns("stop");
      stop.setAttribute("offset", pair[0]);
      stop.setAttribute("stop-color", soft);
      stop.setAttribute("stop-opacity", pair[1]);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);
    svg.appendChild(defs);

    var glow = ns("circle");
    glow.setAttribute("cx", cx); glow.setAttribute("cy", cy); glow.setAttribute("r", mini ? "176" : "178");
    glow.setAttribute("fill", "url(#" + gid + ")");
    svg.appendChild(glow);

    // Geometry: geekplux-like stepped crown — detail R=120 / 0.10–0.45R; mini ~0.9×
    var hrFloorR = mini ? 44 : 48;
    var hrSpan = mini ? 54 : 60;
    var baseR = mini ? 110 : 120;
    var barMinH = mini ? 11 : 12;
    var barMaxH = mini ? 36 : 40;
    var tierH = mini ? [5, 11, 17, 23, 30, 36] : [5, 12, 19, 26, 33, 40];
    var TARGET_N = 48;

    // Layers drawn together (sync reveal).
    var outer = ns("g");
    outer.setAttribute("class", "wk-layer-outer");
    svg.appendChild(outer);
    var inner = ns("g");
    inner.setAttribute("class", "wk-layer-inner");
    svg.appendChild(inner);
    var coreG = ns("g");
    coreG.setAttribute("class", "wk-layer-core");
    svg.appendChild(coreG);

    var barsG = ns("g");
    barsG.setAttribute("class", "sc-outer-bars");
    outer.appendChild(barsG);

    // Always 48 coarse wedges; fixed 0.8deg seam (~8:1 bar:gap crown).
    bars = resampleArr(bars, TARGET_N);
    if (hr.length) hr = resampleArr(hr, TARGET_N).map(function (v) { return Math.round(Number(v) || 0); });
    var N = bars.length || 0;
    var slot = fullDeg / Math.max(N, 1);
    var gapDeg = 0.8;
    // Stored bars are absolute Z0-Z5 heights (5/12/19/26/33/40). Snap to that
    // global ladder; never stretch a chart to its own min/max.
    // barMinH stays at Z1 so Z1–Z5 opacity is unchanged; Z0 is shorter and dimmer.
    var srcTiers = [5, 12, 19, 26, 33, 40];
    var barPaths = [];
    for (var i = 0; i < N; i++) {
      var a0 = aStart + i * slot + gapDeg * 0.5;
      var a1 = aStart + (i + 1) * slot - gapDeg * 0.5;
      if (a1 <= a0) continue;
      var h = Number(bars[i]) || 0;
      var tIdx = 0, best = Infinity;
      for (var ti = 0; ti < srcTiers.length; ti++) {
        var d = Math.abs(h - srcTiers[ti]);
        if (d < best) { best = d; tIdx = ti; }
      }
      var barH = tierH[tIdx];
      var t = (barH - barMinH) / Math.max(barMaxH - barMinH, 1);
      var r0 = baseR;
      var r1 = baseR + barH;
      var p0 = pt(r0, a0), p1 = pt(r0, a1), p2 = pt(r1, a1), p3 = pt(r1, a0);
      // Z1 t=0 → 0.32; Z5 t=1 → 0.95. Z0 (height 5) yields ~0.16, clearly below Z1.
      var op = 0.32 + t * 0.63;
      var path = ns("path");
      path.setAttribute("d",
        "M" + p0[0] + " " + p0[1] +
        " A" + r0 + " " + r0 + " 0 0 1 " + p1[0] + " " + p1[1] +
        " L" + p2[0] + " " + p2[1] +
        " A" + r1 + " " + r1 + " 0 0 0 " + p3[0] + " " + p3[1] + " Z");
      path.setAttribute("fill", soft);
      path.setAttribute("opacity", String(op));
      path.setAttribute("data-op", String(op));
      barsG.appendChild(path);
      barPaths.push({ path: path, op: op, i: i });
    }

    // Inner polar HR area + stroke — full session lap
    var poly = null;
    var area = null;
    if (hr.length) {
      var n = hr.length;
      var hrSlot = fullDeg / Math.max(n, 1);
      var outerPts = [];
      var angles = [];
      for (var hi = 0; hi < n; hi++) {
        var a = aStart + hi * hrSlot;
        var bpm = Number(hr[hi]) || 70;
        var r = hrFloorR + ((bpm - 70) / 120) * hrSpan;
        r = Math.max(hrFloorR + 2, Math.min(baseR - 10, r));
        outerPts.push(pt(r, a));
        angles.push(a);
      }
      var d = "M" + outerPts[0][0].toFixed(2) + " " + outerPts[0][1].toFixed(2);
      for (var oi = 1; oi < outerPts.length; oi++) {
        d += " L" + outerPts[oi][0].toFixed(2) + " " + outerPts[oi][1].toFixed(2);
      }
      // close along floor ring
      for (var ri = n - 1; ri >= 0; ri--) {
        var ip = pt(hrFloorR, angles[ri]);
        d += " L" + ip[0].toFixed(2) + " " + ip[1].toFixed(2);
      }
      d += " Z";
      area = ns("path");
      area.setAttribute("d", d);
      area.setAttribute("fill", soft);
      area.setAttribute("fill-opacity", mini ? "0.28" : "0.32");
      area.setAttribute("stroke", "none");
      area.setAttribute("opacity", "0.95");
      inner.appendChild(area);

      poly = ns("polyline");
      poly.setAttribute("points", outerPts.map(function (p) {
        return p[0].toFixed(1) + "," + p[1].toFixed(1);
      }).join(" "));
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", ink);
      poly.setAttribute("stroke-width", mini ? "2.8" : "2.2");
      poly.setAttribute("stroke-linecap", "round");
      poly.setAttribute("stroke-linejoin", "round");
      poly.setAttribute("opacity", "0.95");
      inner.appendChild(poly);
    }

    // Core: full-circle seed (<1h) or growth rings (≥1h) — matches geekplux pc(min)
    var coreStrokeEls = [];
    if (hours >= 1) {
      var coreStrokeW = mini ? 2.4 : 2.8;
      var coreMaxR = hrFloorR - coreStrokeW / 2 - 2;
      var coreMinR = 15;
      if (coreMaxR < coreMinR) coreMaxR = coreMinR;
      var packCore = (8 + hours * 7) > coreMaxR;
      for (var ring = hours; ring >= 1; ring--) {
        var ringR = packCore
          ? (coreMinR + (coreMaxR - coreMinR) * (ring / hours))
          : (8 + ring * 7);
        var ringOp = hours <= 4
          ? (0.32 + ring * 0.16)
          : (0.32 + 0.60 * (ring / hours));
        if (ringOp > 0.95) ringOp = 0.95;
        if (ringOp < 0.28) ringOp = 0.28;
        var c = ns("circle");
        c.setAttribute("cx", cx); c.setAttribute("cy", cy);
        c.setAttribute("r", String(ringR));
        c.setAttribute("fill", "none");
        c.setAttribute("stroke", soft);
        c.setAttribute("stroke-width", String(coreStrokeW));
        c.setAttribute("opacity", String(ringOp));
        coreG.appendChild(c);
        coreStrokeEls.push(c);
      }
      var coreDot = ns("circle");
      coreDot.setAttribute("cx", cx); coreDot.setAttribute("cy", cy); coreDot.setAttribute("r", mini ? "5" : "4.5");
      coreDot.setAttribute("fill", soft);
      coreG.appendChild(coreDot);
      coreStrokeEls.push(coreDot);
    } else {
      // <1h: solid full-circle seed (not a duration-open arc)
      var seed = ns("circle");
      seed.setAttribute("cx", cx);
      seed.setAttribute("cy", cy);
      seed.setAttribute("r", mini ? "6" : "6.5");
      seed.setAttribute("fill", soft);
      seed.setAttribute("opacity", "0.95");
      coreG.appendChild(seed);
      coreStrokeEls.push(seed);
    }

    // Sync draw: outer + inner + core reveal together over DRAW_MS
    if (!mini && !reduceMotion) {
      barPaths.forEach(function (bp) {
        bp.path.style.opacity = "0";
        bp.path.style.transition = "opacity 0.2s ease-out";
        // same total window as inner/core — stagger within DRAW_MS so crown draws clockwise with them
        bp.path.style.transitionDelay = (bp.i * (DRAW_MS / 1000) / Math.max(N, 1)) + "s";
      });
      if (area) {
        area.style.opacity = "0";
        area.style.transition = "opacity " + (DRAW_MS / 1000) + "s ease-out";
        area.style.transitionDelay = "0s";
      }
      if (poly) {
        try {
          var plen = poly.getTotalLength ? poly.getTotalLength() : 0;
          if (plen > 0) {
            poly.style.strokeDasharray = String(plen);
            poly.style.strokeDashoffset = String(plen);
            poly.style.transition = "stroke-dashoffset " + (DRAW_MS / 1000) + "s cubic-bezier(0.22, 1, 0.36, 1)";
          } else {
            poly.style.opacity = "0";
            poly.style.transition = "opacity " + (DRAW_MS / 1000) + "s ease-out";
          }
        } catch (e) {
          poly.style.opacity = "0";
          poly.style.transition = "opacity " + (DRAW_MS / 1000) + "s ease-out";
        }
      }
      coreStrokeEls.forEach(function (el) {
        el.style.opacity = "0";
        el.style.transition = "opacity " + (DRAW_MS / 1000) + "s ease-out";
      });
      requestAnimationFrame(function () {
        barPaths.forEach(function (bp) {
          bp.path.style.opacity = String(bp.op);
        });
        if (area) area.style.opacity = "0.95";
        if (poly) {
          if (poly.style.strokeDasharray) {
            poly.style.strokeDashoffset = "0";
          } else {
            poly.style.opacity = "0.95";
          }
        }
        coreStrokeEls.forEach(function (el) {
          var target = el.getAttribute("opacity") || "0.95";
          // restore intended opacity (we zeroed via style)
          el.style.opacity = target;
        });
      });
    }

    if (!mini) applyLegendFocus(svg);
  }

  /** GPS silhouette trail with start→end path draw; stage fill follows theme. */
  function drawMap(svg, pointsStr, accent) {
    clearSvg(svg);
    if (!pointsStr) return false;
    var nums = String(pointsStr).trim().split(/\s+/).map(Number).filter(function (n) {
      return !isNaN(n);
    });
    if (nums.length < 4) return false;

    var coords = [];
    var maxV = 0;
    for (var ni = 0; ni < nums.length; ni++) {
      if (Math.abs(nums[ni]) > maxV) maxV = Math.abs(nums[ni]);
    }
    // Detail tracks are already in ~400 viewBox units. Legacy list trails
    // (40-grid integers) keep the old upscale only as a fallback.
    var useDetail = (trailSize && trailSize > 48) || maxV > 48;
    for (var i = 0; i + 1 < nums.length; i += 2) {
      if (useDetail) {
        coords.push([nums[i], nums[i + 1]]);
      } else {
        coords.push([
          (nums[i] / 40) * 340 + 30,
          (nums[i + 1] / 40) * 340 + 30
        ]);
      }
    }

    var defs = ns("defs");
    var filt = ns("filter");
    filt.setAttribute("id", "trailGlow");
    filt.setAttribute("x", "-50%"); filt.setAttribute("y", "-50%");
    filt.setAttribute("width", "200%"); filt.setAttribute("height", "200%");
    var blur = ns("feGaussianBlur");
    blur.setAttribute("stdDeviation", "0.6");
    blur.setAttribute("result", "b");
    filt.appendChild(blur);
    var merge = ns("feMerge");
    var m1 = ns("feMergeNode"); m1.setAttribute("in", "b");
    var m2 = ns("feMergeNode"); m2.setAttribute("in", "SourceGraphic");
    merge.appendChild(m1); merge.appendChild(m2);
    filt.appendChild(merge);
    defs.appendChild(filt);
    svg.appendChild(defs);

    var bg = ns("rect");
    bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
    bg.setAttribute("width", "400"); bg.setAttribute("height", "400");
    bg.setAttribute("rx", "20");
    bg.setAttribute("fill", themeTok("--wk-stage", ""));
    svg.appendChild(bg);

    var d = "M" + coords[0][0].toFixed(1) + " " + coords[0][1].toFixed(1);
    for (var j = 1; j < coords.length; j++) {
      d += " L" + coords[j][0].toFixed(1) + " " + coords[j][1].toFixed(1);
    }
    var path = ns("path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", accent || accentFallback());
    path.setAttribute("stroke-width", "5.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("filter", "url(#trailGlow)");
    svg.appendChild(path);

    // start→end draw animation
    try {
      var len = path.getTotalLength();
      if (len > 0) {
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(reduceMotion ? 0 : len);
        if (!reduceMotion) {
          // force layout then ease to 0
          path.getBoundingClientRect();
          path.style.transition = "stroke-dashoffset 1.35s cubic-bezier(0.22, 1, 0.36, 1)";
          requestAnimationFrame(function () {
            path.style.strokeDashoffset = "0";
          });
        }
      }
    } catch (e) { /* getTotalLength unavailable */ }

    var start = coords[0];
    var halo = ns("circle");
    halo.setAttribute("cx", start[0]); halo.setAttribute("cy", start[1]);
    halo.setAttribute("r", "10");
    halo.setAttribute("fill", "#fff");
    halo.setAttribute("opacity", "0.22");
    svg.appendChild(halo);
    var dot = ns("circle");
    dot.setAttribute("cx", start[0]); dot.setAttribute("cy", start[1]);
    dot.setAttribute("r", "5.5");
    dot.setAttribute("fill", "#fff");
    svg.appendChild(dot);
    return true;
  }

  function ensureTrails() {
    if (trails) return Promise.resolve(trails);
    if (trailPromise) return trailPromise;
    trailPromise = fetch(DETAIL_TRAIL_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("trails " + r.status);
        return r.json();
      })
      .then(function (json) {
        if (!json || !json.points) throw new Error("trails empty");
        trails = json.points;
        trailSize = Number(json.size) || 400;
        window.__wkTrails = { points: trails, size: trailSize };
        return trails;
      })
      .catch(function (err) {
        console.warn("[session-clock] trails fetch failed", err);
        trails = null;
        trailPromise = null;
        return {};
      });
    return trailPromise;
  }

  var yearCache = {};
  function ensureFullSession(item) {
    if (!item) return Promise.resolve(item);
    var key = String(item.idx);
    var cur = itemsByIdx[key] || item;
    if (cur.session && cur.session.bars && cur.session.bars.length) {
      return Promise.resolve(cur);
    }
    var year = (cur.date || item.date || "").slice(0, 4);
    if (!year) return Promise.resolve(cur);
    var hit = yearCache[year];
    var p = hit || fetch(YEAR_BASE + "year-" + year + ".json")
      .then(function (res) {
        if (!res.ok) throw new Error("year " + year);
        return res.json();
      })
      .then(function (json) {
        if (!json || !json.group) throw new Error("year " + year + " empty");
        yearCache[year] = Promise.resolve(json);
        indexMany((json.group && json.group.items) || []);
        return json;
      })
      .catch(function (err) {
        console.warn("[session-clock] year shard fetch failed", year, err);
        delete yearCache[year];
        return null;
      });
    if (!hit) yearCache[year] = p;
    return p.then(function () {
      return itemsByIdx[key] || cur;
    });
  }

  var TIP_COPY = {
    kcal: {
      title: "能耗",
      body: "估算消耗，非实测。"
    }
  };
  function openTipSheet(key) {
    var btn = arguments.length > 1 ? arguments[1] : null;
    var copy = TIP_COPY[key];
    if (!copy) return;
    if (btn && activeTipBtn === btn) {
      closeTipSheet();
      return;
    }
    if (activeTipBtn && activeTipBtn !== btn) {
      activeTipBtn.classList.remove("is-open");
      activeTipBtn.setAttribute("aria-expanded", "false");
      activeTipBtn = null;
    }
    if (btn) {
      activeTipBtn = btn;
      btn.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
    }
  }

  function closeTipSheet() {
    if (activeTipBtn) {
      activeTipBtn.classList.remove("is-open");
      activeTipBtn.setAttribute("aria-expanded", "false");
      activeTipBtn = null;
    }
  }

  function syncLegendVis(hidden) {
    if (legendEl) legendEl.hidden = !!hidden;
    if (hidden) {
      legendHover = null;
      legendFocus = null;
      renderLegendSlot();
    }
  }

  function metricHtml(label, value, unit, tipKey) {
    var isDash = value === "—";
    var info = "";
    if (tipKey && TIP_COPY[tipKey]) {
      info = '<button type="button" class="wk-info-btn" data-wk-tip="' + tipKey +
        '" aria-expanded="false" aria-label="' + esc(label) + ' 说明">' +
        'ⓘ' +
        '<span class="wk-info-tip" role="tooltip">' + esc(TIP_COPY[tipKey].body) + "</span>" +
        "</button>";
    }
    return '<div class="wk-metric" role="listitem">' +
      '<div class="value' + (isDash ? " dash" : "") + '">' + esc(value) +
      (unit && !isDash ? ' <span class="u">' + esc(unit) + "</span>" : "") +
      "</div>" +
      '<div class="label"><span class="wk-metric-head">' + esc(label) + info + "</span></div>" +
      "</div>";
  }

  function updateLegend(session) {
    session = session || {};
    currentZoneSession = session;
    var bars = session.bars;
    var hr = session.hr;
    var hasBars = !!(bars && bars.length);
    var hasHr = !!(hr && hr.length);
    legendCopy.outer = OUTER_LEGEND_COPY;
    legendCopy.inner = hasHr
      ? "同一圈上的心率，越高越靠外。"
      : "没有逐点心率，中圈不显示，请看外圈。";
    legendCopy.core = "不满 1 小时是一颗实心圆点；每满 1 小时多一环。";
    var copy = legendEl ? legendEl.querySelector("[data-legend-inner-copy]") : null;
    if (copy) copy.textContent = legendCopy.inner;
    var innerKey = legendEl ? legendEl.querySelector('.wk-legend-key[data-layer="inner"]') : null;
    if (innerKey) innerKey.classList.toggle("is-weak", !hasHr);
    var outerKey = legendEl ? legendEl.querySelector('.wk-legend-key[data-layer="outer"]') : null;
    if (outerKey) outerKey.classList.toggle("is-weak", !hasBars);
    renderLegendSlot();

  }


  function fmtElapsedSec(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (h > 0) {
      return h + ":" + (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
    }
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  function parseStartMinutes(timeStr) {
    if (!timeStr) return null;
    var m = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return (Number(m[1]) * 60 + Number(m[2])) % (24 * 60);
  }

  function clockAtFrac(frac) {
    if (hrStartMin == null) return null;
    var add = Math.floor((Number(frac) || 0) * hrMovingSec / 60);
    var abs = (hrStartMin + add) % (24 * 60);
    var hh = Math.floor(abs / 60);
    var mm = abs % 60;
    return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function collapseHrScrub() {
    if (!hrScrubEl) return;
    hrScrubEl.classList.remove("is-open");
    if (hrToggleBtn) {
      hrToggleBtn.setAttribute("aria-expanded", "false");
      hrToggleBtn.setAttribute("aria-label", "展开心率趋势");
    }
  }

  function updateHrReadout() {
    if (!hrSeries.length) return;
    var n = hrSeries.length;
    var frac = n <= 1 ? 0 : hrIdx / (n - 1);
    var elapsed = fmtElapsedSec(frac * hrMovingSec);
    var label = hrIdx === 0 ? "起跑" : (hrIdx === n - 1 ? "结束" : "进度 " + Math.round(frac * 100) + "%");
    var clock = clockAtFrac(frac);
    if (hrTimeEl) {
      hrTimeEl.textContent = (clock ? clock + " · " : "") + label + " · " + elapsed;
    }
    if (hrBpmEl) hrBpmEl.textContent = Math.round(hrSeries[hrIdx]) + " bpm";
  }

  function drawHrScrub() {
    if (!hrCanvas || !hrWrapEl || !hrSeries.length) return;
    var ctx = hrCanvas.getContext("2d");
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    var w = hrWrapEl.clientWidth || 280;
    var h = 88;
    hrCanvas.width = Math.round(w * dpr);
    hrCanvas.height = Math.round(h * dpr);
    hrCanvas.style.width = w + "px";
    hrCanvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var pad = { l: 4, r: 4, t: 8, b: 8 };
    var iw = Math.max(1, w - pad.l - pad.r);
    var ih = Math.max(1, h - pad.t - pad.b);
    var min = 100;
    var max = 180;
    var i;
    for (i = 0; i < hrSeries.length; i++) {
      var v = Number(hrSeries[i]) || 0;
      if (v < min) min = Math.max(60, v - 8);
      if (v > max) max = Math.min(220, v + 8);
    }
    if (max <= min) max = min + 1;
    var n = hrSeries.length;

    function xy(ii) {
      var vv = Number(hrSeries[ii]) || min;
      var x = pad.l + (n <= 1 ? 0 : (ii / (n - 1)) * iw);
      var y = pad.t + (1 - (vv - min) / (max - min)) * ih;
      return { x: x, y: y };
    }

    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var p = xy(i);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(pad.l + iw, pad.t + ih);
    ctx.lineTo(pad.l, pad.t + ih);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, themeTok("--wk-hr-fill-top", "transparent"));
    grad.addColorStop(1, themeTok("--wk-hr-fill-bottom", "transparent"));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var p2 = xy(i);
      if (i === 0) ctx.moveTo(p2.x, p2.y); else ctx.lineTo(p2.x, p2.y);
    }
    ctx.strokeStyle = themeTok("--wk-hr", "");
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke();

    var scrub = xy(hrIdx);
    ctx.beginPath();
    ctx.moveTo(scrub.x, pad.t);
    ctx.lineTo(scrub.x, pad.t + ih);
    ctx.strokeStyle = isDarkTheme() ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(scrub.x, scrub.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = themeTok("--wk-hr", "");
    ctx.fill();
  }

  function setHrIdxFromClientX(clientX) {
    if (!hrWrapEl || hrSeries.length < 1) return;
    var rect = hrWrapEl.getBoundingClientRect();
    var x = Math.min(Math.max(clientX - rect.left, 0), rect.width || 1);
    hrIdx = Math.round((x / (rect.width || 1)) * (hrSeries.length - 1));
    if (hrIdx < 0) hrIdx = 0;
    if (hrIdx > hrSeries.length - 1) hrIdx = hrSeries.length - 1;
    updateHrReadout();
    drawHrScrub();
  }

  function setHrScrub(session, item) {
    if (!hrScrubEl) return;
    var series = (session && session.hr) || [];
    if (!series.length) {
      hrSeries = [];
      hrScrubEl.hidden = true;
      collapseHrScrub();
      return;
    }
    hrSeries = series.map(function (v) { return Number(v) || 0; });
    hrMovingSec = Number(session && session.moving != null ? session.moving : (item && item.moving)) || 0;
    if (hrMovingSec <= 0) hrMovingSec = Math.max(1, (hrSeries.length - 1) * 30);
    hrStartMin = parseStartMinutes(item && item.time);
    hrIdx = Math.min(hrSeries.length - 1, Math.max(0, Math.floor(hrSeries.length * 0.42)));
    hrScrubEl.hidden = false;
    collapseHrScrub();
    if (hrAxisStart) hrAxisStart.textContent = "0:00";
    if (hrAxisMid) hrAxisMid.textContent = fmtElapsedSec(hrMovingSec / 2);
    if (hrAxisEnd) hrAxisEnd.textContent = fmtElapsedSec(hrMovingSec);
    updateHrReadout();
  }

  function toggleHrScrub() {
    if (!hrScrubEl || hrScrubEl.hidden || !hrSeries.length) return;
    var open = !hrScrubEl.classList.contains("is-open");
    hrScrubEl.classList.toggle("is-open", open);
    if (hrToggleBtn) {
      hrToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
      hrToggleBtn.setAttribute("aria-label", open ? "收起心率趋势" : "展开心率趋势");
    }
    if (open) {
      requestAnimationFrame(function () {
        updateHrReadout();
        drawHrScrub();
      });
    }
  }

  function syncSplitLink(item) {
    var link = dialog.querySelector("[data-wk-split-link]");
    if (!link) return;
    var id = item && item.run_id;
    var has = !!(item && (item.has_splits === true || item.has_splits === "true"));
    var isRun = !!(item && (item.name === "跑步" || item.bucket === "跑步"));
    if (id == null || id === "" || !has || !isRun) {
      link.hidden = true;
      link.removeAttribute("href");
      return;
    }
    link.href = RUNNING_PAGE + "/#run_" + encodeURIComponent(String(id)) + "/analysis";
    link.hidden = false;
  }

  function fillMeta(item, accent) {
    closeTipSheet();
    var s = item.session || {};
    sportName.textContent = String(item.name || "").toUpperCase();
    sportPill.style.color = accent || accentFallback();
    titleEl.textContent = item.label || item.name || "活动";
    var when = (item.date || "") + (item.time ? " · " + item.time : "");
    whenEl.textContent = when;
    syncSplitLink(item);

    var km = Number(item.km) || 0;
    var elev = Number(s.elev != null ? s.elev : item.elev) || 0;
    var hrAvg = Number(s.hr_avg != null ? s.hr_avg : item.hr) || 0;
    var hrMax = Number(s.hr_max != null ? s.hr_max : item.hr_max) || 0;
    var kcal = Number(s.kcal != null ? s.kcal : item.kcal) || 0;
    var moving = Number(s.moving != null ? s.moving : item.moving) || 0;

    var metricParts = [];
    metricParts.push(metricHtml("距离", km > 0 ? km.toFixed(2) : "—", km > 0 ? "km" : ""));
    metricParts.push(metricHtml("用时", moving > 0 ? elapsedLabel(moving) : "—", ""));
    metricParts.push(metricHtml("爬升", elev > 0 ? String(Math.round(elev)) : "—", elev > 0 ? "m" : ""));
    metricParts.push(metricHtml("平均心率", hrAvg > 0 ? String(Math.round(hrAvg)) : "—", hrAvg > 0 ? "bpm" : ""));
    metricParts.push(metricHtml("最大心率", hrMax > 0 ? String(Math.round(hrMax)) : "—", hrMax > 0 ? "bpm" : ""));
    metricParts.push(metricHtml("能耗", kcal > 0 ? String(Math.round(kcal)) : "—", kcal > 0 ? "kcal" : "", "kcal"));
    metricsEl.innerHTML = metricParts.join("");
  }

  function resetDetailScroll() {
    var metaScroll = dialog.querySelector(".wk-detail-meta-scroll");
    if (metaScroll) metaScroll.scrollTop = 0;
    var bodyScroll = dialog.querySelector(".wk-detail-body");
    if (bodyScroll) bodyScroll.scrollTop = 0;
  }

  function setViz(mode) {
    closeTipSheet();
    var isMap = mode === "map";
    mapPanel.hidden = !isMap;
    clockPanel.hidden = isMap;
    dialog.querySelectorAll(".wk-viz-tab").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-viz") === mode);
    });
  }

  // Map → Clock in the same detail: keep the already-drawn clock, only a
  // ≤150ms opacity appear. No redraw, no panel crossfade, no sliding pill.
  // First open / pager still use the 900ms draw in openDetail.
  function appearDrawnClock() {
    if (!clockPanel || !clockSvg || reduceMotion) return;
    try {
      clockPanel.classList.remove("wk-clock-appear");
      try { clockPanel.offsetWidth; } catch (e2) {}
      clockPanel.classList.add("wk-clock-appear");
      clockSvg.style.opacity = "";
      if (typeof clockSvg.addEventListener === "function") {
        var done = function () {
          clockPanel.classList.remove("wk-clock-appear");
          clockSvg.removeEventListener("animationend", done);
        };
        clockSvg.addEventListener("animationend", done);
      }
    } catch (e) {}
  }

  function updatePager(item) {
    var cards = visibleCards();
    currentList = cards.map(function (el) { return el.getAttribute("data-idx"); });
    var i = currentList.indexOf(String(item.idx));
    var prevIdx = i > 0 ? currentList[i - 1] : null;
    var nextIdx = i >= 0 && i < currentList.length - 1 ? currentList[i + 1] : null;
    var prevItem = prevIdx != null ? itemsByIdx[prevIdx] : null;
    var nextItem = nextIdx != null ? itemsByIdx[nextIdx] : null;
    pager.hidden = !(prevItem || nextItem);
    var prevBtn = pager.querySelector("[data-wk-prev]");
    var nextBtn = pager.querySelector("[data-wk-next]");
    prevBtn.disabled = !prevItem;
    nextBtn.disabled = !nextItem;
    var prevLabel = prevItem ? (prevItem.label || "") : "";
    var nextLabel = nextItem ? (nextItem.label || "") : "";
    prevBtn.querySelector("[data-prev-title]").textContent = prevLabel;
    nextBtn.querySelector("[data-next-title]").textContent = nextLabel;
    prevBtn.setAttribute("title", prevLabel);
    nextBtn.setAttribute("title", nextLabel);
    prevBtn.setAttribute("aria-label", prevLabel ? ("上一条：" + prevLabel) : "没有上一条");
    nextBtn.setAttribute("aria-label", nextLabel ? ("下一条：" + nextLabel) : "没有下一条");
    prevBtn.setAttribute("data-go-idx", prevIdx || "");
    nextBtn.setAttribute("data-go-idx", nextIdx || "");
  }

  function openDetail(item, cardEl) {
    if (!item) return;
    legendFocus = null;
    legendHover = null;
    ensureFullSession(item).then(function (full) {
      item = full || item;
      currentIdx = String(item.idx);
      var accent = accentOf(cardEl) || accentFallback();
      try { dialog.style.setProperty("--workout-accent", accent); } catch (eAccent) {}
      fillMeta(item, accent);
      resetDetailScroll();
      var hasTrail = !!item.has_trail;
      var session = Object.assign({}, item.session || {});
      session.moving = Number(session.moving != null ? session.moving : item.moving) || 0;
      if (!session.bars) session.bars = [];
      if (!session.hr) session.hr = [];
      updateLegend(session);
      setHrScrub(session, item);
      legendEl.querySelectorAll(".wk-legend-key[data-layer]").forEach(function (row) {
        row.classList.remove("is-on");
        row.style.color = accent;
        row.setAttribute("aria-pressed", "false");
      });
      renderLegendSlot();

      // GPS → tabs (keep preferredViz across pager). No GPS → clock only (ignore map pref).
      toolsEl.hidden = !hasTrail;

      drawSessionClock(clockSvg, session, accent, false);

      function show() {
        // Already-open <dialog>.showModal() throws InvalidStateError (HTML spec,
        // WebKit/iPad included). That aborted updatePager, so the buttons kept
        // the previous activity's data-go-idx and a second click looked dead.
        try {
          if (typeof dialog.showModal === "function") {
            if (!dialog.open) dialog.showModal();
          } else if (!dialog.hasAttribute("open")) {
            dialog.setAttribute("open", "");
          }
        } catch (e) {}
        setPageScrollLock(true);
        updatePager(item);
        resetDetailScroll();
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(function () { resetDetailScroll(); });
        }
      }

      function applyPreferredClock() {
        setViz("clock");
        syncLegendVis(false);
        refreshLegendChrome();
      }

      if (hasTrail) {
        var mode = (preferredViz === "clock") ? "clock" : "map";
        setViz(mode);
        syncLegendVis(mode !== "clock");
        if (mode === "clock") refreshLegendChrome();
        ensureTrails().then(function (pts) {
          var ok = drawMap(mapSvg, pts[String(item.idx)], accent);
          if (!ok) {
            toolsEl.hidden = true;
            applyPreferredClock();
          } else if (mode === "clock") {
            // map drawn in background; stay on clock tab
            setViz("clock");
            syncLegendVis(false);
            refreshLegendChrome();
          }
          show();
        });
      } else {
        applyPreferredClock();
        show();
      }
    });
  }

  function setPageScrollLock(on) {
    try {
      document.documentElement.classList.toggle("wk-detail-open", !!on);
      document.body.classList.toggle("wk-detail-open", !!on);
    } catch (e) {}
  }

  function closeDetail() {
    closeTipSheet();
    collapseHrScrub();
    setPageScrollLock(false);
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  var detailClosedByKey = false;
  if (dialog && typeof dialog.addEventListener === "function") {
    dialog.addEventListener("close", function () {
      setPageScrollLock(false);
      // Mouse close restores focus to the card; drop it so the hover tip
      // does not stay up as a leftover selected state. Keyboard (Escape)
      // keeps focus so the user can continue from that card.
      var active = document.activeElement;
      if (!detailClosedByKey && active && active.classList && active.classList.contains("run-card")) {
        active.blur();
      }
      detailClosedByKey = false;
    });
  }

  function itemFromCard(card) {
    var idx = card.getAttribute("data-idx");
    var cached = itemsByIdx[idx];
    if (cached) return cached;
    try {
      var raw = card.getAttribute("data-wk");
      if (raw) {
        indexItem(JSON.parse(raw));
        if (itemsByIdx[idx]) return itemsByIdx[idx];
      }
    } catch (e) {}
    return {
      idx: idx,
      label: (card.querySelector(".name") || {}).textContent || "",
      name: (card.className.match(/kind-(\S+)/) || [])[1] || "",
      date: "",
      has_trail: !!card.querySelector("svg.rmap"),
      session: null
    };
  }

  if (hrWrapEl && typeof hrWrapEl.addEventListener === "function") {
    hrWrapEl.addEventListener("pointerdown", function (e) {
      if (!hrSeries.length || !hrScrubEl || !hrScrubEl.classList.contains("is-open")) return;
      hrDragging = true;
      try { hrWrapEl.setPointerCapture(e.pointerId); } catch (err) {}
      setHrIdxFromClientX(e.clientX);
    });
    hrWrapEl.addEventListener("pointermove", function (e) {
      if (!hrDragging) return;
      setHrIdxFromClientX(e.clientX);
    });
    hrWrapEl.addEventListener("pointerup", function () { hrDragging = false; });
    hrWrapEl.addEventListener("pointercancel", function () { hrDragging = false; });
  }
  if (typeof window.addEventListener === "function") {
    window.addEventListener("resize", function () {
      if (hrScrubEl && hrScrubEl.classList.contains("is-open")) drawHrScrub();
    });
  }

  function setLegendHover(layer) {
    if (legendHover === layer) return;
    legendHover = layer;
    refreshLegendChrome();
  }

  if (clockSvg && typeof clockSvg.addEventListener === "function") {
    clockSvg.addEventListener("pointermove", function (ev) {
      if (!isLegendVisible() || !isFinePointer(ev)) return;
      setLegendHover(legendLayerFromPoint(ev.clientX, ev.clientY));
    });
    clockSvg.addEventListener("pointerleave", function () {
      if (!legendHover) return;
      legendHover = null;
      refreshLegendChrome();
    });
  }
  if (legendEl && typeof legendEl.addEventListener === "function") {
    legendEl.addEventListener("pointermove", function (ev) {
      if (!isLegendVisible() || !isFinePointer(ev)) return;
      var key = ev.target.closest && ev.target.closest(".wk-legend-key[data-layer]");
      var layer = (key && legendEl.contains(key)) ? key.getAttribute("data-layer") : null;
      setLegendHover(layer);
    });
    legendEl.addEventListener("pointerleave", function () {
      if (!legendHover) return;
      legendHover = null;
      refreshLegendChrome();
    });
  }

  document.addEventListener("click", function (ev) {
    var hrToggle = ev.target.closest && ev.target.closest("[data-wk-hr-toggle]");
    if (hrToggle && hrScrubEl && hrScrubEl.contains(hrToggle)) {
      ev.preventDefault();
      toggleHrScrub();
      return;
    }

    var tipBtn = ev.target.closest && ev.target.closest("[data-wk-tip]");
    if (tipBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      openTipSheet(tipBtn.getAttribute("data-wk-tip"), tipBtn);
      return;
    }

    if (activeTipBtn) closeTipSheet();

    var splitLink = ev.target.closest && ev.target.closest("[data-wk-split-link]");
    if (splitLink) return;

    var legendRow = ev.target.closest && ev.target.closest(".wk-legend-key[data-layer]");
    if (legendRow && legendEl && legendEl.contains(legendRow) && !legendEl.hidden) {
      ev.preventDefault();
      pinLegendLayer(legendRow.getAttribute("data-layer"));
      return;
    }

    if (isLegendVisible() && ev.target.closest && ev.target.closest("svg.wk-sclock")) {
      var ringLayer = legendLayerFromPoint(ev.clientX, ev.clientY);
      if (ringLayer) {
        ev.preventDefault();
        pinLegendLayer(ringLayer);
        return;
      }
    }

    var closeBtn = ev.target.closest && ev.target.closest("[data-wk-close]");
    if (closeBtn) { closeDetail(); return; }

    var tab = ev.target.closest && ev.target.closest(".wk-viz-tab");
    if (tab) {
      var mode = tab.getAttribute("data-viz");
      var wasClock = clockPanel && !clockPanel.hidden;
      var shouldAppear = mode === "clock" && !wasClock && !reduceMotion && clockSvg;
      if (shouldAppear) clockSvg.style.opacity = "0";
      preferredViz = mode;
      setViz(mode);
      var item = itemsByIdx[currentIdx] || {};
      syncLegendVis(item.has_trail ? mode !== "clock" : false);
      if (!legendEl.hidden) {
        updateLegend(item.session || {});
        refreshLegendChrome();
      }
      if (shouldAppear) {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(function () { appearDrawnClock(); });
        } else {
          appearDrawnClock();
        }
      }
      return;
    }

    var go = ev.target.closest && ev.target.closest("[data-go-idx]");
    if (go && go.getAttribute("data-go-idx")) {
      var next = itemsByIdx[go.getAttribute("data-go-idx")];
      if (next) {
        var card = document.querySelector('.run-card[data-idx="' + next.idx + '"]');
        openDetail(next, card);
      }
      return;
    }

    var card = ev.target.closest && ev.target.closest(".run-card[data-idx]");
    if (card && card.closest(".act-switcher")) {
      openDetail(itemFromCard(card), card);
      return;
    }

    // Blank / backdrop: dismiss legend copy first; don't swallow pager/tab/close.
    if (ev.target === dialog) {
      if (clearLegendExplain()) { ev.preventDefault(); return; }
      closeDetail();
      return;
    }
    if (dialog.open && dialog.contains && dialog.contains(ev.target)) {
      var inLegend = legendEl && !legendEl.hidden && legendEl.contains(ev.target);
      if (!inLegend && clearLegendExplain()) ev.preventDefault();
    }
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      if (activeTipBtn) { closeTipSheet(); return; }
      if (dialog.open && clearLegendExplain()) { ev.preventDefault(); return; }
      if (dialog.open) {
        detailClosedByKey = true;
        closeDetail();
      }
      return;
    }
    if (ev.key === "Enter" && ev.target.classList && ev.target.classList.contains("run-card")) {
      openDetail(itemFromCard(ev.target), ev.target);
    }
  });

  window.__wkIndexItems = indexMany;
  window.__wkDrawMiniClock = function (svg, session, accent) {
    drawSessionClock(svg, session, accent, true);
  };

  function hydrateFromDom() {
    // Index list cards only — Session Clock lives in detail, not as list mini clocks.
    // No-trail cards keep SSR/lazy emoji (.ico); trail cards keep .rmap thumb.
    document.querySelectorAll(".run-card[data-idx]").forEach(function (card) {
      try {
        var raw = card.getAttribute("data-wk");
        if (raw) {
          indexItem(JSON.parse(raw));
        }
      } catch (e) {
        console.warn("[session-clock] hydrate failed", e);
      }
    });
  }

  document.addEventListener("workouts:year-loaded", function () {
    setTimeout(hydrateFromDom, 0);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrateFromDom);
  } else {
    hydrateFromDom();
  }

  // Detail trails load on first open of a trail activity.
})();
