import { BUILD } from "./build";
import { CONFIG } from "./config";
import { Audio } from "./engine/audio";
import { Display } from "./engine/canvas";
import { Input } from "./engine/input";
import { startLoop } from "./engine/loop";
import { attachTouchControls } from "./engine/touch";
import { watchForNewBuild } from "./engine/updateCheck";
import { Game } from "./game/game";
import { invalidateBackground } from "./render/background";
import { Renderer } from "./render/renderer";

async function main(): Promise<void> {
  const screen = document.getElementById("game") as HTMLCanvasElement;
  const display = new Display(screen);

  const versionEl = document.getElementById("version");
  if (versionEl) versionEl.textContent = `build ${__BUILD_STAMP__}`;
  // version.txt only exists in a real `vite build` output, not the dev server.
  if (!import.meta.env.DEV) watchForNewBuild(__BUILD_STAMP__);

  const input = new Input();
  input.attach();

  const audio = new Audio();
  input.onFirstInput = () => audio.unlock();

  const game = new Game(input, audio);
  attachTouchControls(input, game);

  const renderer = new Renderer();
  await renderer.init();

  // Optional per-fixed-step hook — the dev test harness plugs its bot runner +
  // event log in here. No-op (and dead-code-eliminated) in a prod build.
  let onFixedStep: (dtMs: number) => void = () => {};

  const loop = startLoop({
    update: (dt) => {
      onFixedStep(dt); // must precede sample() so virtual taps land this tick
      input.sample();
      game.update(dt);
    },
    render: (realDt) => {
      renderer.render(display.bctx, game, realDt);
      display.present();
    },
  });

  if (import.meta.env.DEV && BUILD.mode === "dev") {
    // Dynamically imported so harness/ + bots/ stay out of the shipping bundle.
    const { Harness } = await import("./harness/harness");
    const harness = new Harness(game, input);
    harness.bindLoop(loop);
    onFixedStep = (dt) => harness.tick(dt);

    Object.assign(window as unknown as Record<string, unknown>, {
      __game: game,
      __renderer: renderer,
      __harness: harness.api,
      __CONFIG: CONFIG,
      // Live-patch one config value by path (used by the config tuner running
      // in a parent frame). Mutates in place so the running attempt is kept,
      // exactly like the config.ts hot-reload does.
      __applyConfigPatch: (path: string[], value: unknown) => {
        let obj = CONFIG as unknown as Record<string, unknown>;
        for (let i = 0; i < path.length - 1; i++) {
          obj = obj[path[i]] as Record<string, unknown>;
          if (!obj) return;
        }
        obj[path[path.length - 1]] = value;
        invalidateBackground();
      },
    });
  }
}

// `config.ts` and `labels.ts` self-accept their own HMR — a live edit to either
// hot-swaps with no page reload. Nothing to wire here.

void main();
