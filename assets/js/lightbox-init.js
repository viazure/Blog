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
    '<svg viewBox="0 0 384 512" width="12" height="16" fill="currentColor" aria-hidden="true"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg>';

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
      '<button type="button" class="lb-close" aria-label="关闭">' + ICON_CLOSE + "</button>" +
      '<button type="button" class="lb-arrow lb-prev" aria-label="上一张">' + ICON_PREV + "</button>" +
      '<div class="lb-spinner" hidden aria-hidden="true"></div>' +
      '<button type="button" class="lb-arrow lb-next" aria-label="下一张">' + ICON_NEXT + "</button>" +
      '<div class="lb-meta"><div class="lb-title"></div><div class="lb-counter"></div></div>';
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
      if (front && front !== el) park(front);
      el.classList.add("is-front");
      ov.insertBefore(el, spinner);
      front = el;
      shown = index;
      cur = index;
      pending = -1;
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
      if (!e.target.closest(".lb-arrow, .lb-close")) close();
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
