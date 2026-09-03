/**
 * The test-harness page. Drives the game in an `<iframe>` through its
 * `window.__harness` API (see `harness.ts`) — scenario setup, loop transport,
 * the rule-based bots, a live state panel and the event log.
 *
 * This page is a thin remote control; all the logic lives in `harness.ts` /
 * `bots.ts` so headless tests share it.
 */
import type { HarnessApi } from "./harness";
import type { View } from "./view";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const iframe = $<HTMLIFrameElement>("#game");
const statusEl = $("#status");

let api: HarnessApi | null = null;

function frame(): (Window & { __harness?: HarnessApi }) | null {
  try {
    return iframe.contentWindow as never;
  } catch {
    return null;
  }
}

iframe.addEventListener("load", () => {
  api = null;
  let tries = 0;
  const poll = setInterval(() => {
    const h = frame()?.__harness;
    if (h) {
      clearInterval(poll);
      api = h;
      onReady();
    } else if (++tries > 50) {
      clearInterval(poll);
      setStatus("no __harness in the frame — BUILD.mode must be 'dev'", true);
    }
  }, 80);
});

function onReady(): void {
  if (!api) return;
  const sel = $<HTMLSelectElement>("#bot");
  if (!sel.options.length) {
    for (const k of api.botKinds) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = k;
      sel.append(o);
    }
  }
  setStatus("ready");
  syncTransport();
}

// --- scenario -------------------------------------------------------

$("#apply").addEventListener("click", () => {
  api?.configure({
    seed: num("#seed"),
    escalate: num("#escalate"),
    speedLevel: num("#speed"),
    gender: val("#gender") as "m" | "f",
    scene: val("#scene") as View["scene"],
  });
  clearLog();
});
$("#spawn").addEventListener("click", () => api?.spawnMissile({}));

// --- bot -----------------------------------------------------------

$("#runbot").addEventListener("click", () => {
  api?.runBot(val("#bot") as Parameters<HarnessApi["runBot"]>[0], num("#botseed"));
  syncTransport();
});
$("#stopbot").addEventListener("click", () => {
  api?.stopBot();
  syncTransport();
});

// --- transport ----------------------------------------------------

$("#pause").addEventListener("click", () => {
  if (!api) return;
  if (api.paused) api.resume();
  else api.pause();
  syncTransport();
});
$("#step1").addEventListener("click", () => api?.step(1));
$("#step30").addEventListener("click", () => api?.step(30));
$<HTMLSelectElement>("#speed").addEventListener("change", (e) => {
  api?.setSpeed(Number((e.target as HTMLSelectElement).value));
});
$("#clearlog").addEventListener("click", () => {
  api?.clearEvents();
  clearLog();
});

function syncTransport(): void {
  if (!api) return;
  $("#pause").textContent = api.paused ? "resume" : "pause";
  $("#pause").classList.toggle("on", api.paused);
  $("#runbot").classList.toggle("on", api.bot !== null);
}

// --- panel refresh (rAF, independent of the sim) -----------------

const seenEvents = new Set<string>();
function render(): void {
  requestAnimationFrame(render);
  if (!api) return;
  try {
    paintState(api.view());
    for (const e of api.events()) {
      const key = `${e.tMs}:${e.type}:${e.detail}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      appendEvent(e.tMs, e.type, e.detail);
    }
  } catch {
    /* frame reloading */
  }
}

function paintState(v: View): void {
  const m = v.missile;
  $("#state").textContent = [
    `scene     ${v.scene}`,
    `escalate  ${v.escalate}    speed ${v.speedLevel}    seed ${v.seed}`,
    `score     PUNCH ${v.scores.punches}/${v.limits.punch}  ` +
      `EXPLODE ${v.scores.deflects}/${v.limits.explode}  MISS ${v.scores.hits}/${v.limits.miss}`,
    `puncher   x=${v.puncher.x.toFixed(1)} face=${v.puncher.facing === 1 ? "→" : "←"} ` +
      `${v.puncher.state}/${v.puncher.phase}${v.puncher.hitboxLive ? "  ⚡" : ""}`,
    m
      ? `missile   x=${m.x.toFixed(1)} v=${m.vx.toFixed(0)} ${m.dir === -1 ? "←" : "→"} ` +
        `${m.state}  gap=${m.gap.toFixed(1)}  tti=${Number.isFinite(m.timeToImpactMs) ? m.timeToImpactMs.toFixed(0) + "ms" : "—"}`
      : `missile   —   (next in ${v.spawnInMs.toFixed(0)}ms)`,
    `camp      ${v.camp.armed ? `${(v.camp.fraction * 100).toFixed(0)}%` : "disarmed"}` +
      `${v.camp.graceMs > 0 ? `  GRACE ${(v.camp.graceMs / 1000).toFixed(1)}s` : ""}` +
      `${v.camp.warnLevel > 0 ? `  ⚠ WARN ${(v.camp.warnLevel * 100).toFixed(0)}%` : ""}` +
      `${v.camp.soundOn ? "  ♪" : ""}  threatX=${v.camp.threatX.toFixed(0)}`,
    v.dropper
      ? `dropper   x=${v.dropper.x.toFixed(0)} y=${v.dropper.y.toFixed(0)} ${v.dropper.state}` +
        `  eta=${Number.isFinite(v.dropper.etaMs) ? v.dropper.etaMs.toFixed(0) + "ms" : "—"}`
      : `dropper   —`,
    `timers    downed=${v.timers.downed | 0} tired=${v.timers.tired | 0} ` +
      `end=${v.timers.end | 0} esc=${v.timers.escalation | 0}`,
  ].join("\n");
}

function appendEvent(tMs: number, type: string, detail: string): void {
  const log = $("#log");
  const row = document.createElement("div");
  row.className = `ev ${type}`;
  row.innerHTML =
    `<span class="t">${tMs}</span><span class="ty">${type}</span><span>${detail}</span>`;
  log.append(row);
  log.scrollTop = log.scrollHeight;
}

function clearLog(): void {
  $("#log").innerHTML = "";
  seenEvents.clear();
}

// --- helpers -----------------------------------------------------

function num(sel: string): number {
  return Number($<HTMLInputElement>(sel).value);
}
function val(sel: string): string {
  return $<HTMLInputElement | HTMLSelectElement>(sel).value;
}
function setStatus(msg: string, err = false): void {
  statusEl.textContent = msg;
  statusEl.className = err ? "err" : "";
}

setStatus("loading game frame…");
render();
