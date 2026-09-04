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

    // `?sound=1` auto-unlocks audio on load. Normal play never needs this —
    // the real first keypress/tap already unlocks it — but a bot-driven
    // session (harness.runBot()) never sends a real input event at all, so
    // audio.unlock() otherwise never fires and every sfx call is a silent
    // no-op. Meant for driving the bot with real sound on, e.g. recording a
    // playthrough. (A real browser's autoplay policy may still hold actual
    // playback muted until the tab gets some real interaction — this just
    // ensures the game's own side of the handshake happens.)
    if (new URLSearchParams(location.search).has("sound")) audio.unlock();

    // Recording-tool glue: tap `audio`'s output into a MediaRecorder so a
    // scratch Playwright script can capture real (non-silent) sound
    // alongside its video, driven entirely from page.evaluate() calls.
    let audioChunks: Blob[] = [];
    let audioRecorder: MediaRecorder | null = null;

    Object.assign(window as unknown as Record<string, unknown>, {
      __game: game,
      __renderer: renderer,
      __harness: harness.api,
      __CONFIG: CONFIG,
      __startAudioCapture: (): boolean => {
        const stream = audio.captureStream();
        if (!stream) return false;
        audioChunks = [];
        audioRecorder = new MediaRecorder(stream);
        audioRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };
        audioRecorder.start();
        return true;
      },
      __stopAudioCapture: (): Promise<string> =>
        new Promise((resolve) => {
          if (!audioRecorder) {
            resolve("");
            return;
          }
          audioRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: "audio/webm" });
            const reader = new FileReader();
            reader.onloadend = () => {
              const b64 = (reader.result as string).split(",")[1] ?? "";
              resolve(b64);
            };
            reader.readAsDataURL(blob);
          };
          audioRecorder.stop();
        }),
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
