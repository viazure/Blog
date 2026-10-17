(() => {
    "use strict";
    const LS_THEME_KEY = "theme-preference";
    const THEMES = {
        LIGHT: "light",
        DARK: "dark",
        AUTO: "auto",
    };

    const body = document.body;
    const root = document.documentElement;
    const config = body.getAttribute("data-theme") || THEMES.AUTO;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const getSystemTheme = () =>
        media.matches ? THEMES.DARK : THEMES.LIGHT;

    const getPreference = () => {
        const stored = localStorage.getItem(LS_THEME_KEY);
        if (
            stored === THEMES.LIGHT ||
            stored === THEMES.DARK ||
            stored === THEMES.AUTO
        ) {
            return stored;
        }
        if (config === THEMES.DARK || config === THEMES.LIGHT) {
            return config;
        }
        return THEMES.AUTO;
    };

    const resolveTheme = (pref) =>
        pref === THEMES.AUTO ? getSystemTheme() : pref;

    const applyTheme = (state) => {
        root.classList.toggle(THEMES.DARK, state === THEMES.DARK);
        root.classList.toggle(THEMES.LIGHT, state === THEMES.LIGHT);
    };

    const sync = () => applyTheme(resolveTheme(getPreference()));

    sync();
    requestAnimationFrame(() => body.classList.remove("notransition"));

    const onSystemChange = () => {
        if (getPreference() === THEMES.AUTO) sync();
    };
    if (typeof media.addEventListener === "function") {
        media.addEventListener("change", onSystemChange);
    } else if (typeof media.addListener === "function") {
        media.addListener(onSystemChange);
    }

    const toggleTheme = (event) => {
        event.preventDefault();
        const nextResolved =
            resolveTheme(getPreference()) === THEMES.DARK
                ? THEMES.LIGHT
                : THEMES.DARK;
        localStorage.setItem(
            LS_THEME_KEY,
            nextResolved === getSystemTheme() ? THEMES.AUTO : nextResolved
        );
        applyTheme(nextResolved);
    };

    window.addEventListener("DOMContentLoaded", () => {
        const lamp = document.getElementById("mode");
        if (lamp) {
            lamp.addEventListener("click", toggleTheme);
        }

        const cbox = document.getElementById("menu-trigger");
        if (cbox) {
            cbox.addEventListener("change", function () {
                const area = document.querySelector(".wrapper");
                if (!area) return;
                if (this.checked) return area.classList.add("blurry");
                area.classList.remove("blurry");
            });
        }
    });
})();
