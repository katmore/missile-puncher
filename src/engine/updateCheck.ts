/**
 * Notices a new deploy and force-reloads onto it.
 *
 * Needed specifically for the hosted build: an iOS "Add to Home Screen"
 * standalone app is notoriously sticky about re-checking its own start URL
 * (way more than plain Safari), so a fix can ship and the icon on someone's
 * phone keeps opening the old build indefinitely. `index.html` and the JS
 * bundle are exactly what's stuck in that stale cache, so re-fetching THEM
 * proves nothing — this polls a separate `version.txt` (see vite.config.ts
 * `versionFile()`) with `cache: "no-store"` instead, and once it disagrees
 * with the build actually running, does a real navigation (not
 * `location.reload()`, which can itself replay from the same stale cache) to
 * a cache-busted URL so the platform has no cached response left to hand back.
 */
export function watchForNewBuild(currentStamp: string): void {
  const check = (): void => {
    if (document.hidden) return;
    fetch(`./version.txt?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : null))
      .then((latest) => {
        if (latest && latest.trim() && latest.trim() !== currentStamp) {
          location.replace(`${location.pathname}?v=${Date.now()}`);
        }
      })
      .catch(() => {
        /* offline / blocked — just keep playing the build that's loaded */
      });
  };
  document.addEventListener("visibilitychange", check);
  setInterval(check, 60_000);
}
