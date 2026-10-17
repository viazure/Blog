(() => {
    "use strict";

    const dialog = document.getElementById("search-dialog");
    const openBtns = document.querySelectorAll("[data-search-open]");
    const closeBtn = dialog?.querySelector("[data-search-close]");
    const input = dialog?.querySelector("[data-search-input]");
    const results = dialog?.querySelector("[data-search-results]");
    const empty = dialog?.querySelector("[data-search-empty]");
    const error = dialog?.querySelector("[data-search-error]");
    const hint = dialog?.querySelector("[data-search-hint]");
    const tipsBtn = dialog?.querySelector("[data-search-tips]");
    const syntax = dialog?.querySelector("#search-syntax-tip");
    if (!dialog || !input || !results) return;

    const setSyntaxOpen = (open) => {
        if (!syntax || !tipsBtn) return;
        syntax.hidden = !open;
        tipsBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };

    let fuse = null;
    let loading = null;
    let active = -1;
    const lastFocus = { el: null };

    const loadEngine = async () => {
        if (fuse) return fuse;
        if (loading) return loading;

        loading = (async () => {
            const fuseSrc = dialog.dataset.fuse;
            await new Promise((resolve, reject) => {
                if (window.Fuse) {
                    resolve();
                    return;
                }
                const script = document.createElement("script");
                script.src = fuseSrc;
                script.async = true;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });

            const res = await fetch(dialog.dataset.index);
            if (!res.ok) throw new Error("search index missing");
            const pages = await res.json();
            fuse = new window.Fuse(pages, {
                keys: [
                    { name: "title", weight: 0.65 },
                    { name: "tags", weight: 0.2 },
                    { name: "content", weight: 0.15 },
                ],
                includeMatches: true,
                includeScore: true,
                findAllMatches: true,
                ignoreLocation: true,
                useExtendedSearch: true,
                shouldSort: true,
                threshold: 0.32,
                distance: 1000,
                minMatchCharLength: 1,
                fieldNormWeight: 0.8,
            });
            return fuse;
        })();

        try {
            return await loading;
        } catch (err) {
            loading = null;
            throw err;
        }
    };

    const items = () => [...results.querySelectorAll("a")];

    const setActive = (index) => {
        const links = items();
        if (!links.length) {
            active = -1;
            return;
        }
        active = (index + links.length) % links.length;
        links.forEach((link, i) => {
            link.classList.toggle("is-active", i === active);
            if (i === active) link.scrollIntoView({ block: "nearest" });
        });
    };

    const mergeRanges = (ranges) => {
        const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
        const out = [];
        for (const [start, end] of sorted) {
            const last = out[out.length - 1];
            if (!last || start > last[1] + 1) out.push([start, end]);
            else last[1] = Math.max(last[1], end);
        }
        return out;
    };

    const highlighted = (text, ranges) => {
        const frag = document.createDocumentFragment();
        if (!text) return frag;
        const marks = ranges?.length ? mergeRanges(ranges) : [];
        if (!marks.length) {
            frag.appendChild(document.createTextNode(text));
            return frag;
        }
        let cursor = 0;
        for (const [start, end] of marks) {
            const from = Math.max(0, start);
            const to = Math.min(text.length - 1, end);
            if (to < cursor) continue;
            if (from > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, from)));
            const mark = document.createElement("mark");
            mark.textContent = text.slice(from, to + 1);
            frag.appendChild(mark);
            cursor = to + 1;
        }
        if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
        return frag;
    };

    const tokensOf = (query) =>
        (query || "")
            .split(/[\s|]+/)
            .map((token) => token.replace(/^['^=!]+/, "").replace(/\$+$/, "").trim())
            .filter((token) => token.length);

    const tokenRanges = (text, query) => {
        const ranges = [];
        if (!text) return ranges;
        const hay = text.toLowerCase();
        for (const token of tokensOf(query)) {
            const needle = token.toLowerCase();
            let from = 0;
            while (from <= hay.length - needle.length) {
                const at = hay.indexOf(needle, from);
                if (at < 0) break;
                ranges.push([at, at + needle.length - 1]);
                from = at + needle.length;
            }
        }
        return ranges;
    };

    const paintRanges = (text, query, fuseRanges) => {
        const exact = tokenRanges(text, query);
        if (exact.length) return exact;
        return (fuseRanges || []).filter(([start, end]) => end - start >= 1);
    };

    const matchesFor = (hit, key) =>
        (hit.matches || []).filter((item) => {
            const name = Array.isArray(item.key) ? item.key.join(".") : item.key;
            return name === key;
        });

    const windowed = (value, ranges, radius = 36, max = 160) => {
        if (!value) return { text: "", ranges: [] };
        const first = ranges?.[0]?.[0] ?? -1;
        const start = first < 0 ? 0 : Math.max(0, first - radius);
        const slice = value.slice(start, start + max);
        if (!slice) return { text: "", ranges: [] };
        const prefix = start > 0 ? "…" : "";
        const suffix = start + max < value.length ? "…" : "";
        const text = `${prefix}${slice}${suffix}`;
        const offset = (start > 0 ? 1 : 0) - start;
        const mapped = (ranges || [])
            .map(([from, to]) => [from + offset, to + offset])
            .filter(([from, to]) => to >= 0 && from < text.length)
            .map(([from, to]) => [Math.max(0, from), Math.min(text.length - 1, to)]);
        return { text, ranges: mapped };
    };

    const showStatus = ({ hintHidden = true, emptyHidden = true, errorHidden = true } = {}) => {
        if (hint) hint.hidden = hintHidden;
        if (empty) empty.hidden = emptyHidden;
        if (error) error.hidden = errorHidden;
    };

    const render = (hits, query) => {
        results.replaceChildren();
        active = -1;
        if (!hits.length) {
            showStatus({ emptyHidden: false });
            return;
        }
        showStatus();
        const frag = document.createDocumentFragment();
        hits.slice(0, 8).forEach((hit) => {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.href = hit.item.permalink;

            const title = document.createElement("span");
            title.className = "search-dialog-item-title";
            title.appendChild(highlighted(hit.item.title, paintRanges(hit.item.title, query, matchesFor(hit, "title")[0]?.indices)));
            a.appendChild(title);

            if (hit.item.date) {
                const time = document.createElement("time");
                time.className = "search-dialog-item-date";
                time.dateTime = hit.item.date;
                time.textContent = hit.item.date;
                a.appendChild(time);
            }

            const body = hit.item.content || "";
            const bodyRanges = paintRanges(body, query, matchesFor(hit, "content").flatMap((item) => item.indices || []));
            const excerpt = windowed(body, bodyRanges);
            if (excerpt.text) {
                const p = document.createElement("span");
                p.className = "search-dialog-item-excerpt";
                p.appendChild(highlighted(excerpt.text, excerpt.ranges));
                a.appendChild(p);
            }

            const tagMatches = matchesFor(hit, "tags");
            const tagValues = tagMatches.length
                ? tagMatches
                : (hit.item.tags || [])
                      .filter((tag) => tokenRanges(String(tag), query).length)
                      .map((tag) => ({ value: String(tag), indices: tokenRanges(String(tag), query) }));
            if (tagValues.length) {
                const tags = document.createElement("span");
                tags.className = "search-dialog-item-tags";
                tagValues.forEach((match, i) => {
                    if (i) tags.appendChild(document.createTextNode(" "));
                    const tag = document.createElement("span");
                    tag.appendChild(highlighted(match.value, paintRanges(match.value, query, match.indices)));
                    tags.appendChild(tag);
                });
                a.appendChild(tags);
            }

            li.appendChild(a);
            frag.appendChild(li);
        });
        results.appendChild(frag);
        setActive(0);
    };

    const resetList = () => {
        results.replaceChildren();
        active = -1;
        showStatus({ hintHidden: false });
    };

    const showError = () => {
        results.replaceChildren();
        active = -1;
        showStatus({ errorHidden: false });
    };

    const open = async () => {
        const menu = document.getElementById("menu-trigger");
        if (menu) menu.checked = false;
        lastFocus.el = document.activeElement;
        dialog.hidden = false;
        document.body.classList.add("search-open");
        input.focus();
        try {
            await loadEngine();
            const q = input.value.trim();
            if (q && fuse) render(fuse.search(q), q);
            else resetList();
        } catch {
            showError();
        }
    };

    const close = () => {
        dialog.hidden = true;
        document.body.classList.remove("search-open");
        input.value = "";
        resetList();
        setSyntaxOpen(false);
        if (lastFocus.el && typeof lastFocus.el.focus === "function") lastFocus.el.focus();
    };

    tipsBtn?.addEventListener("click", () => {
        setSyntaxOpen(syntax.hidden);
    });
    openBtns.forEach((btn) => btn.addEventListener("click", open));
    closeBtn?.addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) close();
    });

    document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            if (dialog.hidden) open();
            else close();
        }
        if (dialog.hidden) return;
        if (event.key === "Escape") {
            event.preventDefault();
            if (syntax && !syntax.hidden) {
                setSyntaxOpen(false);
                return;
            }
            close();
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(active + 1);
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(active - 1);
        }
        if (event.key === "Enter" && active >= 0) {
            const link = items()[active];
            if (link) {
                event.preventDefault();
                link.click();
            }
        }
    });

    input.addEventListener("input", async () => {
        const q = input.value.trim();
        setSyntaxOpen(false);
        if (!q) {
            resetList();
            return;
        }
        try {
            await loadEngine();
            render(fuse.search(q), q);
        } catch {
            showError();
        }
    });
})();
