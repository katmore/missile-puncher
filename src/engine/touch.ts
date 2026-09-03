import { SCREEN_W, SCREEN_H } from "../config";
import type { Game } from "../game/game";
import { selectSlots } from "../render/hud";
import type { Input } from "./input";

/**
 * Touch controls, auto-enabled on coarse-pointer devices (adds `body.touch`).
 * Everything works anywhere on screen — one code path, branched at the point of
 * action:
 *
 *  - **drag** (press + slide past the slop) → move. A floating stick appears
 *    under the thumb; slide L / R past the deadzone. Ignored on the select
 *    screen.
 *  - **tap** (press + release, no drag) →
 *    - in play: punch.
 *    - on select: on a puncher → move the cursor there (tap it again, or tap
 *      anywhere else, to start); off both punchers → start with the current
 *      cursor.
 *
 * Multi-touch works (one thumb drags to move, the other taps to punch). Wired
 * through the same virtual-input layer the harness uses.
 */
export function attachTouchControls(input: Input, game: Game): void {
  const coarse =
    matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  if (!coarse) return;
  document.body.classList.add("touch");

  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  const pad = document.getElementById("touchpad");
  const base = document.getElementById("stick-base");
  const knob = document.getElementById("stick-knob");
  if (!canvas || !pad || !base || !knob) return;

  // --- go fullscreen when rotated to landscape --------------------------
  // The Fullscreen API needs a user gesture, so we arm on rotate-to-landscape
  // and fire on the next tap. Best-effort: no-ops where unsupported (iOS
  // Safari, sandboxed iframes without `allow="fullscreen"`).
  const landscape = (): boolean => window.innerWidth >= window.innerHeight;
  let wantFullscreen = landscape();
  const goFullscreen = (): void => {
    if (
      !wantFullscreen ||
      !document.fullscreenEnabled ||
      document.fullscreenElement
    ) {
      return;
    }
    wantFullscreen = false; // one shot per rotate — never nag
    void document.documentElement
      .requestFullscreen?.()
      .then(() => {
        (
          screen.orientation as unknown as {
            lock?: (o: string) => Promise<void>;
          }
        )?.lock?.("landscape")
          .catch(() => {});
      })
      .catch(() => {});
  };
  addEventListener("orientationchange", () => {
    if (landscape()) wantFullscreen = true;
  });
  matchMedia("(orientation: landscape)").addEventListener?.("change", (ev) => {
    if (ev.matches) wantFullscreen = true;
  });

  // The hint shows the touch scheme during SELECT, fades once play starts.
  // Refreshed from the touch handlers (covers the tap that starts the game) and
  // polled (covers auto scene changes, e.g. escalation → play).
  const hint = document.getElementById("hint");
  let wasSelect: boolean | null = null;
  const refreshHint = (): void => {
    if (!hint) return;
    const onSelect = game.scene === "select";
    if (onSelect === wasSelect) return;
    wasSelect = onSelect;
    hint.classList.toggle("faded", !onSelect);
    hint.textContent = onSelect
      ? "tap a puncher  ·  tap again to start"
      : "drag: move   ·   tap: punch";
  };
  const poll = (): void => {
    requestAnimationFrame(poll);
    refreshHint();
  };
  poll();

  const SLOP = 14; // px of travel before a touch becomes a "drag" (a move)
  const DEAD = 14; // px past the anchor before a direction registers
  const MAX = 46; // knob travel from the anchor
  const TAP_MS = 400; // released within this, never dragged → a tap

  interface Touch {
    x0: number;
    y0: number;
    t0: number;
    drag: boolean;
  }
  const touches = new Map<number, Touch>();
  let stickId: number | null = null;

  const place = (el: HTMLElement, x: number, y: number): void => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  const showStick = (x: number, y: number): void => {
    place(base, x, y);
    place(knob, x, y);
    base.style.display = "block";
    knob.style.display = "block";
  };
  const dropStick = (): void => {
    input.hold("left", false);
    input.hold("right", false);
    base.style.display = "none";
    knob.style.display = "none";
    stickId = null;
  };

  /** client px → backbuffer px (canvas fills its box, no internal letterbox). */
  const toGame = (cx: number, cy: number): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((cx - r.left) / r.width) * SCREEN_W,
      y: ((cy - r.top) / r.height) * SCREEN_H,
    };
  };

  const selectTap = (cx: number, cy: number): void => {
    const g = toGame(cx, cy);
    for (const s of selectSlots(game)) {
      const onIt =
        g.x >= s.x - 10 &&
        g.x <= s.x + s.w + 10 &&
        g.y >= s.y - 16 &&
        g.y <= s.y + s.h + 4;
      if (onIt) {
        if (game.gender === s.gender) game.startFromSelect();
        else game.gender = s.gender; // move the cursor; don't start yet
        return;
      }
    }
    game.startFromSelect(); // tapped past the punchers → go with the current one
  };

  pad.addEventListener("pointerdown", (e) => {
    input.firstInput();
    goFullscreen();
    touches.set(e.pointerId, {
      x0: e.clientX,
      y0: e.clientY,
      t0: performance.now(),
      drag: false,
    });
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic / stale id */
    }
  });

  pad.addEventListener("pointermove", (e) => {
    const t = touches.get(e.pointerId);
    if (!t || game.scene === "select") return;
    const dx = e.clientX - t.x0;
    const dy = e.clientY - t.y0;

    if (!t.drag && Math.hypot(dx, dy) > SLOP) {
      t.drag = true;
      if (stickId === null) {
        stickId = e.pointerId;
        showStick(t.x0, t.y0);
      }
    }
    if (e.pointerId === stickId) {
      const dist = Math.hypot(dx, dy) || 1;
      const k = dist > MAX ? MAX / dist : 1;
      place(knob, t.x0 + dx * k, t.y0 + dy * k);
      input.hold("left", dx < -DEAD);
      input.hold("right", dx > DEAD);
    }
  });

  const forget = (id: number): void => {
    touches.delete(id);
    if (id === stickId) dropStick();
  };
  pad.addEventListener("pointerup", (e) => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    const tap = !t.drag && performance.now() - t.t0 < TAP_MS;
    forget(e.pointerId);
    if (!tap) return;
    if (game.scene === "select") selectTap(t.x0, t.y0);
    else input.tap("punch");
    refreshHint();
  });
  for (const ev of ["pointercancel", "lostpointercapture"]) {
    pad.addEventListener(ev, (e) => forget((e as PointerEvent).pointerId));
  }
}
