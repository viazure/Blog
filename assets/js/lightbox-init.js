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

  function open(images, index) {
    if (!images.length || document.querySelector(".lb-overlay")) return;

    var cur = index;
    var trigger = images[index];
    var prevOverflow = document.body.style.overflow;
    var prevPosition = document.body.style.position;
    var prevTop = document.body.style.top;
    var prevWidth = document.body.style.width;
    var scrollY = window.scrollY || window.pageYOffset;

    var ov = document.createElement("div");
    ov.className = "lb-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "图片查看");
    ov.innerHTML =
      '<button type="button" class="lb-close" aria-label="关闭">' + ICON_CLOSE + "</button>" +
      '<button type="button" class="lb-arrow lb-prev" aria-label="上一张">' + ICON_PREV + "</button>" +
      '<img class="lb-img" alt="">' +
      '<button type="button" class="lb-arrow lb-next" aria-label="下一张">' + ICON_NEXT + "</button>" +
      '<div class="lb-meta"><div class="lb-title"></div><div class="lb-counter"></div></div>';
    document.body.appendChild(ov);

    // 锁滚动：overflow + fixed，兼顾桌面与 iOS Safari
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = "-" + scrollY + "px";
    document.body.style.width = "100%";

    var imgEl = ov.querySelector(".lb-img");
    var titleEl = ov.querySelector(".lb-title");
    var counter = ov.querySelector(".lb-counter");
    var prevBtn = ov.querySelector(".lb-prev");
    var nextBtn = ov.querySelector(".lb-next");
    var closeBtn = ov.querySelector(".lb-close");
    var many = images.length > 1;
    prevBtn.hidden = nextBtn.hidden = !many;
    counter.hidden = !many;

    function preload(i) {
      var el = new Image();
      el.src = images[(i + images.length) % images.length].src;
    }

    function render(i, animate) {
      cur = (i + images.length) % images.length;
      var item = images[cur];
      if (animate) {
        imgEl.classList.remove("lb-anim");
        void imgEl.offsetWidth;
      }
      imgEl.src = item.src;
      var title = item.getAttribute("title") || item.alt || "";
      imgEl.alt = title;
      titleEl.textContent = title;
      titleEl.hidden = !title;
      if (animate) imgEl.classList.add("lb-anim");
      counter.textContent = cur + 1 + " / " + images.length;
      preload(cur + 1);
      preload(cur - 1);
    }

    function close() {
      document.removeEventListener("keydown", onKey);
      ov.remove();
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
      if (trigger) {
        if (!trigger.hasAttribute("tabindex")) trigger.setAttribute("tabindex", "-1");
        try {
          trigger.focus({ preventScroll: true });
        } catch (err) {
          trigger.focus();
        }
      }
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft" && many) {
        e.preventDefault();
        render(cur - 1, true);
      } else if (e.key === "ArrowRight" && many) {
        e.preventDefault();
        render(cur + 1, true);
      } else if (e.key === "Tab") {
        // 简易焦点陷阱：Tab 只在关闭 / 左右箭头之间循环
        var focusables = [closeBtn];
        if (many) {
          focusables.push(prevBtn, nextBtn);
        }
        var idx = focusables.indexOf(document.activeElement);
        if (idx < 0) {
          e.preventDefault();
          closeBtn.focus();
          return;
        }
        e.preventDefault();
        var next = e.shiftKey
          ? focusables[(idx - 1 + focusables.length) % focusables.length]
          : focusables[(idx + 1) % focusables.length];
        next.focus();
      }
    }

    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      render(cur - 1, true);
    });
    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      render(cur + 1, true);
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
      render(dx > 0 ? cur - 1 : cur + 1, true);
    }, { passive: true });

    ov.addEventListener("click", function (e) {
      if (swiped) {
        swiped = false;
        return;
      }
      if (!e.target.closest(".lb-arrow, .lb-close")) close();
    });

    document.addEventListener("keydown", onKey);
    render(cur, false);
    closeBtn.focus();
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
