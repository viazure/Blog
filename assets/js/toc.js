(() => {
    "use strict";

    const toc = document.getElementById("post-toc");
    const fab = document.getElementById("toc-fab");
    if (!toc || !fab) return;

    const closeBtn = toc.querySelector("[data-toc-close]");
    const links = [...toc.querySelectorAll("a[href^='#']")];

    const hrefId = (link) => {
        const raw = link.getAttribute("href") || "";
        if (!raw.startsWith("#") || raw.length < 2) return "";
        try {
            return decodeURIComponent(raw.slice(1));
        } catch {
            return raw.slice(1);
        }
    };

    const headings = links
        .map((link) => document.getElementById(hrefId(link)))
        .filter(Boolean);

    // 右边留白放得下目录时算宽屏。目录和按钮一起在滚过一段后出现。
    const fits = () => {
        const column = document.querySelector(".wrapper.post article");
        if (!column) return false;
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const panelWidth = 16 * rem;
        const edge = column.getBoundingClientRect().right;
        const roomRight = document.documentElement.clientWidth - 30 - panelWidth;
        return edge + 24 <= roomRight;
    };

    const revealed = () => (window.scrollY || document.documentElement.scrollTop) > 300;

    // null 跟随宽窄默认；open / closed 是读者按过按钮后的选择。
    let preference = null;

    const syncFab = () => {
        fab.classList.toggle("is-visible", revealed());
    };

    const open = () => {
        toc.classList.add("is-open");
        fab.setAttribute("aria-expanded", "true");
        syncFab();
    };

    const close = () => {
        toc.classList.remove("is-open");
        fab.setAttribute("aria-expanded", "false");
        syncFab();
    };

    const apply = () => {
        syncFab();
        if (!revealed()) {
            close();
            return;
        }
        if (preference === "open" || (preference === null && fits())) open();
        else close();
    };

    const toggle = () => {
        if (toc.classList.contains("is-open")) {
            preference = "closed";
            close();
        } else {
            preference = "open";
            open();
        }
    };

    fab.addEventListener("click", toggle);
    closeBtn?.addEventListener("click", () => {
        preference = "closed";
        close();
    });

    toc.addEventListener("click", (event) => {
        if (!event.target.closest("a[href^='#']") || fits()) return;
        preference = null;
        close();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !toc.classList.contains("is-open")) return;
        preference = "closed";
        close();
    });

    window.addEventListener("resize", apply);
    window.addEventListener("scroll", apply, { passive: true });
    apply();

    if (!headings.length) return;

    const scroller = () => toc.querySelector(".post-toc-nav");

    const keepInView = (link) => {
        const box = scroller();
        if (!box) return;
        const br = box.getBoundingClientRect();
        const lr = link.getBoundingClientRect();
        if (lr.top < br.top + 8) {
            box.scrollTop -= br.top + 8 - lr.top;
        } else if (lr.bottom > br.bottom - 8) {
            box.scrollTop += lr.bottom - (br.bottom - 8);
        }
    };

    let currentId = "";
    const setActive = (id) => {
        if (!id || id === currentId) return;
        currentId = id;
        links.forEach((link) => {
            const on = hrefId(link) === id;
            link.classList.toggle("is-active", on);
            if (on && toc.classList.contains("is-open")) keepInView(link);
        });
    };

    const sync = () => {
        const marker = window.scrollY + Math.min(160, window.innerHeight * 0.22);
        let current = headings[0];
        for (const heading of headings) {
            const top = heading.getBoundingClientRect().top + window.scrollY;
            if (top <= marker + 1) current = heading;
            else break;
        }
        setActive(current.id);
    };

    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
})();
