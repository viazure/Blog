(() => {
    const gttButton = document.getElementById("totop");
    if (!gttButton) return;

    const onScroll = () => {
        const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
        const show = y > 300;
        gttButton.style.visibility = show ? "visible" : "hidden";
        gttButton.style.opacity = show ? "1" : "0";
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
})();
