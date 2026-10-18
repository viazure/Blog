/**
 * 正文图片灯箱（自写，无第三方库）
 *
 * 行为对齐 moment.upstairs.cn 的 window.lightbox：
 * 点击正文图片打开全屏查看器，左右切换、键盘、计数、点空白关闭。
 * 覆盖层由本脚本创建并在关闭时移除，不观察、不改写其它 DOM。
 * 选择器限定 article 内的 .page-content，避免评论区（Twikoo）图片误入图集。
 */
(function () {
  "use strict";

  var CONTENT_SELECTOR = "article .page-content";
  var SWIPE_THRESHOLD = 50;

  var ICON_PREV =
    '<svg viewBox="0 0 320 512" width="10" height="16" fill="currentColor" aria-hidden="true"><path d="M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z"/></svg>';
  var ICON_NEXT =
    '<svg viewBox="0 0 320 512" width="10" height="16" fill="currentColor" aria-hidden="true"><path d="M310.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256 73.4 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z"/></svg>';
  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><g transform="translate(12 12) scale(0.66666667) translate(-12 -12)"><path d="M21 3 3 21"/><path d="m3 3 18 18"/></g></svg>';
  // Lucide rotate-cw。默认没有圆底，悬停才出圆。笔画外沿统一为 12。
  var ICON_ROTATE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="translate(12 12) scale(0.66666667) translate(-12 -12)"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g></svg>';
  // Lucide maximize：按原图显示。minimize：适应屏幕。
  var ICON_ORIGINAL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="translate(12 12) scale(0.66666667) translate(-12 -12)"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></g></svg>';
  var ICON_FIT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="translate(12 12) scale(0.66666667) translate(-12 -12)"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></g></svg>';

  /** 正文图片：跳过外链包裹的图，以及未排开或不足 48px 的装饰图 */
  function isContentImage(img) {
    if (!img.getAttribute("src") || img.closest("a")) return false;
    if (img.clientWidth < 48) return false;
    if (img.complete && img.naturalWidth > 0 && img.naturalWidth < 48) return false;
    return true;
  }

  function collectImages() {
    return Array.prototype.filter.call(
      document.querySelectorAll(CONTENT_SELECTOR + " img"),
      isContentImage
    );
  }

  // 看过的图留在页面里，关掉灯箱也不销毁。再次打开直接用已经解码的那张。
  var POOL_LIMIT = 32;
  var poolRoot = null;
  var pool = Object.create(null);
  var poolOrder = [];

  function ensurePool() {
    if (poolRoot) return;
    poolRoot = document.createElement("div");
    poolRoot.className = "lb-pool";
    poolRoot.setAttribute("aria-hidden", "true");
    document.body.appendChild(poolRoot);
  }

  function remember(src) {
    var at = poolOrder.indexOf(src);
    if (at >= 0) poolOrder.splice(at, 1);
    poolOrder.push(src);
    while (poolOrder.length > POOL_LIMIT) {
      var old = poolOrder[0];
      var victim = pool[old];
      if (!victim || !poolRoot.contains(victim)) break;
      poolOrder.shift();
      victim.onload = null;
      victim.onerror = null;
      victim.remove();
      delete pool[old];
    }
  }

  function take(src) {
    ensurePool();
    var el = pool[src];
    if (!el) {
      el = document.createElement("img");
      el.className = "lb-img";
      el.decoding = "async";
      el.alt = "";
      el.setAttribute("aria-hidden", "true");
      pool[src] = el;
      poolRoot.appendChild(el);
      el.src = src;
    }
    remember(src);
    return el;
  }

  function park(el) {
    if (!el || !poolRoot) return;
    el.onload = null;
    el.onerror = null;
    el.classList.remove("is-front");
    el.alt = "";
    el.style.width = "";
    el.style.height = "";
    el.style.removeProperty("--lb-rot");
    el.setAttribute("aria-hidden", "true");
    poolRoot.appendChild(el);
  }

  function open(images, index) {
    if (!images.length || document.querySelector(".lb-overlay")) return;

    var cur = index;
    var root = document.documentElement;
    var prevOverflow = root.style.overflow;
    var prevPad = root.style.paddingRight;
    var scrollbar = window.innerWidth - root.clientWidth;

    var ov = document.createElement("dialog");
    ov.className = "lb-overlay";
    ov.setAttribute("aria-label", "图片查看");
    ov.tabIndex = -1;
    ov.innerHTML =
      '<div class="lb-tools">' +
        '<button type="button" class="lb-tool lb-fit" aria-label="按原图显示" title="按原图显示" aria-pressed="false">' + ICON_ORIGINAL + "</button>" +
        '<button type="button" class="lb-tool lb-rotate" aria-label="旋转" title="旋转">' + ICON_ROTATE + "</button>" +
        '<button type="button" class="lb-tool lb-close" aria-label="关闭" title="关闭">' + ICON_CLOSE + "</button>" +
      "</div>" +
      '<button type="button" class="lb-arrow lb-prev" aria-label="上一张" title="上一张">' + ICON_PREV + "</button>" +
      '<div class="lb-stage"><div class="lb-frame"></div></div>' +
      '<div class="lb-spinner" hidden aria-hidden="true"></div>' +
      '<button type="button" class="lb-arrow lb-next" aria-label="下一张" title="下一张">' + ICON_NEXT + "</button>" +
      '<div class="lb-meta"><div class="lb-counter"></div><div class="lb-title"></div></div>';
    document.body.appendChild(ov);

    // 模态对话框自己锁住背后的滚动。这里只补上滚动条宽度，避免滚动条消失时页面横移。
    root.style.overflow = "hidden";
    if (scrollbar > 0) root.style.paddingRight = scrollbar + "px";

    var front = null;
    var spinner = ov.querySelector(".lb-spinner");
    var titleEl = ov.querySelector(".lb-title");
    var counter = ov.querySelector(".lb-counter");
    var prevBtn = ov.querySelector(".lb-prev");
    var nextBtn = ov.querySelector(".lb-next");
    var closeBtn = ov.querySelector(".lb-close");
    var fitBtn = ov.querySelector(".lb-fit");
    var rotateBtn = ov.querySelector(".lb-rotate");
    var stage = ov.querySelector(".lb-stage");
    var frame = ov.querySelector(".lb-frame");
    var fitMode = "fit";
    var rot = 0;

    // 原图横向最多 1080px。适应模式按窗口尽量铺满，可放大。
    var ORIGINAL_MAX_W = 1080;
    function placeTitle() {
      if (!titleEl) return;
      if (titleEl.hidden || !front) {
        titleEl.style.left = "";
        titleEl.style.top = "";
        titleEl.style.bottom = "";
        titleEl.style.transform = "";
        return;
      }
      var ir = front.getBoundingClientRect();
      var or = ov.getBoundingClientRect();
      var th = titleEl.offsetHeight || 28;
      var top = ir.bottom - or.top - th - 12;
      if (top + th > ov.clientHeight - 8) top = ov.clientHeight - th - 12;
      if (top < 8) top = 8;
      titleEl.style.left = ir.left + ir.width / 2 - or.left + "px";
      titleEl.style.top = top + "px";
      titleEl.style.bottom = "auto";
      titleEl.style.transform = "translateX(-50%)";
    }

    function applyView() {
      ov.classList.toggle("is-original", fitMode === "original");
      ov.classList.toggle("is-rot-90", rot === 90);
      ov.classList.toggle("is-rot-180", rot === 180);
      ov.classList.toggle("is-rot-270", rot === 270);
      if (front && front.naturalWidth) {
        front.style.setProperty("--lb-rot", rot + "deg");
        var sideways = rot % 180 !== 0;
        var nw = front.naturalWidth;
        var nh = front.naturalHeight;
        var visW = sideways ? nh : nw;
        var visH = sideways ? nw : nh;
        var scale;
        if (fitMode === "original") {
          var cap = Math.min(ORIGINAL_MAX_W, Math.max(280, ov.clientWidth - 96));
          scale = Math.min(1, cap / visW);
          frame.style.width = (sideways ? nh * scale : nw * scale) + "px";
          frame.style.height = (sideways ? nw * scale : nh * scale) + "px";
        } else {
          // 标题叠在图上，只给顶栏和左右留一点边。
          var maxW = Math.max(240, ov.clientWidth - 32);
          var maxH = Math.max(240, ov.clientHeight - 48);
          scale = Math.min(maxW / visW, maxH / visH);
          frame.style.width = "";
          frame.style.height = "";
        }
        front.style.width = nw * scale + "px";
        front.style.height = nh * scale + "px";
      }
      var original = fitMode === "original";
      var fitTip = original ? "适应屏幕" : "按原图显示";
      fitBtn.setAttribute("aria-label", fitTip);
      fitBtn.setAttribute("title", fitTip);
      fitBtn.setAttribute("aria-pressed", original ? "true" : "false");
      fitBtn.innerHTML = original ? ICON_FIT : ICON_ORIGINAL;
      requestAnimationFrame(placeTitle);
    }

    function resetView() {
      fitMode = "fit";
      rot = 0;
      stage.scrollTop = 0;
      applyView();
    }
    var many = images.length > 1;
    prevBtn.hidden = nextBtn.hidden = !many;
    counter.hidden = !many;

    var token = 0;
    var shown = -1;
    var pending = -1;
    var spinnerTimer = 0;

    function hideSpinner() {
      clearTimeout(spinnerTimer);
      spinner.hidden = true;
    }

    function preload(i) {
      var item = images[(i + images.length) % images.length];
      if (item) take(item.currentSrc || item.src);
    }

    function onImgEnter() {
      ov.classList.add("is-title-on");
    }
    function onImgLeave() {
      ov.classList.remove("is-title-on");
    }
    function clearTitleHover(el) {
      if (!el) return;
      el.removeEventListener("pointerenter", onImgEnter);
      el.removeEventListener("pointerleave", onImgLeave);
    }

    function reveal(index, el) {
      var item = images[index];
      var title = item.getAttribute("title") || item.alt || "";
      el.onload = null;
      el.onerror = null;
      el.alt = title;
      el.setAttribute("aria-hidden", "false");
      titleEl.textContent = title;
      titleEl.hidden = !title;
      counter.textContent = index + 1 + " / " + images.length;
      if (front && front !== el) {
        clearTitleHover(front);
        park(front);
      }
      ov.classList.remove("is-title-on");
      el.classList.add("is-front");
      frame.appendChild(el);
      el.addEventListener("pointerenter", onImgEnter);
      el.addEventListener("pointerleave", onImgLeave);
      front = el;
      shown = index;
      cur = index;
      pending = -1;
      resetView();
      if (!el.naturalWidth) {
        el.addEventListener("load", function onReady() {
          el.removeEventListener("load", onReady);
          if (front === el) applyView();
        });
      }
      hideSpinner();
      preload(index + 1);
      preload(index - 1);
    }

    function render(i) {
      var index = (i + images.length) % images.length;
      if (index === shown) {
        cur = shown;
        pending = -1;
        token++;
        hideSpinner();
        return;
      }
      if (index === pending) return;
      cur = index;
      pending = index;
      var item = images[index];
      var src = item.currentSrc || item.src;
      var seq = ++token;
      var el = take(src);
      hideSpinner();

      function go() {
        if (seq !== token || closed) return;
        reveal(index, el);
      }

      // 这张元素已经解码过，直接拿出来。不要再等一次加载。
      if (el.complete && el.naturalWidth > 0) {
        go();
        return;
      }

      var settled = false;
      function ready() {
        if (settled) return;
        settled = true;
        go();
      }
      el.onload = ready;
      el.onerror = ready;
      if (el.complete) ready();
      if (shown === index || seq !== token) return;
      if (shown < 0) spinner.hidden = false;
      else spinnerTimer = setTimeout(function () {
        if (seq === token) spinner.hidden = false;
      }, 160);
    }

    var closed = false;
    function unlock() {
      root.style.overflow = prevOverflow;
      root.style.paddingRight = prevPad;
    }
    function finish() {
      if (closed) return;
      closed = true;
      clearTimeout(spinnerTimer);
      clearTimeout(idleTimer);
      window.removeEventListener("resize", applyView);
      clearTitleHover(front);
      ov.classList.remove("is-title-on");
      if (front) park(front);
      front = null;
      document.removeEventListener("keydown", onKey);
      unlock();
      if (ov.isConnected) ov.remove();
    }
    function close() {
      if (ov.open) ov.close();
      else finish();
    }

    function onKey(e) {
      if (e.key === "ArrowLeft" && many) {
        e.preventDefault();
        render(cur - 1);
      } else if (e.key === "ArrowRight" && many) {
        e.preventDefault();
        render(cur + 1);
      }
    }

    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      render(cur - 1);
    });
    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      render(cur + 1);
    });
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      close();
    });
    fitBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      fitMode = fitMode === "original" ? "fit" : "original";
      stage.scrollTop = 0;
      applyView();
    });
    rotateBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      rot = (rot + 90) % 360;
      stage.scrollTop = 0;
      applyView();
    });
    window.addEventListener("resize", applyView);

    var idleTimer = 0;
    function showChrome() {
      clearTimeout(idleTimer);
      ov.classList.remove("is-idle");
    }
    function armIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        ov.classList.add("is-idle");
      }, 5000);
    }
    ov.addEventListener("pointerenter", showChrome);
    ov.addEventListener("pointerleave", armIdle);

    var startX = 0;
    var startY = 0;
    var swiped = false;
    ov.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      swiped = false;
    }, { passive: true });
    ov.addEventListener("touchend", function (e) {
      if (!many) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;
      swiped = true;
      render(dx > 0 ? cur - 1 : cur + 1);
    }, { passive: true });

    ov.addEventListener("click", function (e) {
      if (swiped) {
        swiped = false;
        return;
      }
      if (ov.classList.contains("is-idle")) {
        showChrome();
        return;
      }
      if (!e.target.closest(".lb-arrow, .lb-tool")) close();
    });

    ov.addEventListener("close", finish);

    document.addEventListener("keydown", onKey);
    render(cur);
    ov.showModal();
    ov.focus({ preventScroll: true, focusVisible: false });
  }

  document.addEventListener("click", function (e) {
    var img = e.target.closest(CONTENT_SELECTOR + " img");
    if (!img || !isContentImage(img)) return;
    var images = collectImages();
    var index = images.indexOf(img);
    if (index < 0) return;
    e.preventDefault();
    open(images, index);
  });
})();
