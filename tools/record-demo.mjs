/**
 * Records a bot playthrough as an mp4 with real (non-silent) sound —
 * `node tools/record-demo.mjs`. Starts its own dev server, drives a bot via
 * the dev harness (`?harness=1&sound=1`), captures video (Playwright) and
 * audio (a MediaStreamAudioDestinationNode tapped off `Audio.captureStream()`,
 * see src/engine/audio.ts) in parallel, then muxes them with ffmpeg.
 *
 * Requirements (one-time):
 *   - `npx playwright install chromium` — this script does NOT bundle a
 *     browser. Set CHROMIUM_PATH to point at a specific binary instead (e.g.
 *     a sandboxed environment with a browser preinstalled at a fixed path).
 *   - `ffmpeg` on PATH.
 *
 * Options (env vars, all optional):
 *   BOT=perfect|reflex|sloppy|idle   (default: idle — dies fast, exercises
 *                                     the full select/downed/play cycle)
 *   DURATION_MS=14000                total wall-clock length to record
 *   DWELL_MS=1600                    how long to hold on select/downed before
 *                                    letting the bot punch through — without
 *                                    this the bot exits those screens the
 *                                    instant it's legally allowed to, which
 *                                    can be faster than a viewer can register
 *   OUT=demo.mp4                     output file path
 *   PORT=5183                        dev server port used for the recording
 *
 * The pacing loop is event-driven (`harness.onEvent`), not polled — a poll
 * loop checking scene state every 100-150ms is NOT tight enough: the `idle`
 * bot's natural punch-out on "downed" can complete in ~240ms, faster than
 * such a poll can reliably catch it, so the intended dwell silently never
 * engages. `onEvent` fires synchronously the instant the harness detects the
 * scene change, so there's no window for it to slip past.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BOT = process.env.BOT ?? "idle";
const DURATION_MS = Number(process.env.DURATION_MS ?? 14_000);
const DWELL_MS = Number(process.env.DWELL_MS ?? 1_600);
const OUT = process.env.OUT ?? "demo.mp4";
const PORT = Number(process.env.PORT ?? 5183);
const VIEWPORT = { width: 640, height: 448 }; // 320x224 at 2x

function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) reject(new Error(`dev server never came up at ${url}`));
          else setTimeout(tryOnce, 300);
        });
    };
    tryOnce();
  });
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "missile-punch-record-"));
  console.log("scratch dir:", workDir);

  console.log(`starting dev server on :${PORT}...`);
  // Spawn vite's own binary directly, not via `npx` — npx wraps it in a
  // shell/wrapper process, so killing *that* pid later leaves the real vite
  // process (and the port) running behind.
  const vite = spawn(
    join(ROOT, "node_modules", ".bin", "vite"),
    ["--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  vite.on("error", (e) => {
    throw e;
  });

  try {
    await waitForServer(`http://localhost:${PORT}/`);

    const launchOpts = { args: ["--autoplay-policy=no-user-gesture-required"] };
    if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
    const browser = await chromium.launch(launchOpts);

    const context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: workDir, size: VIEWPORT },
    });
    const videoStart = Date.now();
    const page = await context.newPage();

    await page.goto(`http://localhost:${PORT}/?harness=1&sound=1`);
    await page.waitForFunction(
      () => window.__game && window.__harness && window.__startAudioCapture,
    );

    const audioOk = await page.evaluate(() => window.__startAudioCapture());
    if (!audioOk) throw new Error("audio capture failed to start (no AudioContext?)");
    const leadOffsetMs = Date.now() - videoStart;
    console.log("bot:", BOT, "| duration:", DURATION_MS, "ms | lead offset:", leadOffsetMs, "ms");

    // Runs entirely in-page — see the header comment on why onEvent, not polling.
    await page.evaluate(
      ({ totalMs, dwellMs, botKind }) =>
        new Promise((resolve) => {
          const h = window.__harness;
          const off = h.onEvent((e) => {
            if (e.type !== "scene") return;
            const toScene = e.detail.split(" → ")[1];
            if (toScene === "select" || toScene === "downed") {
              // Deferred to a macrotask, not called synchronously from
              // inside this listener: `onEvent` fires from deep inside the
              // rAF -> fixed-timestep -> harness.tick() call chain, and
              // calling stopBot()/runBot() synchronously from there was
              // observed to truncate the MediaRecorder audio output after
              // the first such call (verified: 3.7s of audio captured out
              // of an intended 8s). Deferring with setTimeout(fn, 0) moves
              // the call out of that chain and the truncation goes away.
              setTimeout(() => {
                h.stopBot();
                setTimeout(() => h.runBot(botKind), dwellMs);
              }, 0);
            }
          });
          h.runBot(botKind);
          setTimeout(() => {
            off();
            resolve();
          }, totalMs);
        }),
      { totalMs: DURATION_MS, dwellMs: DWELL_MS, botKind: BOT },
    );

    const audioB64 = await page.evaluate(() => window.__stopAudioCapture());
    writeFileSync(join(workDir, "audio.webm"), Buffer.from(audioB64, "base64"));

    await context.close(); // flushes the video file to disk
    await browser.close();

    const videoFile = readdirSync(workDir).find(
      (f) => f.endsWith(".webm") && f !== "audio.webm",
    );
    if (!videoFile) throw new Error("no video file produced");

    const leadOffsetSec = (leadOffsetMs / 1000).toFixed(3);
    console.log("muxing...");
    const ff = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-ss", leadOffsetSec,
        "-i", join(workDir, videoFile),
        "-i", join(workDir, "audio.webm"),
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-shortest",
        OUT,
      ],
      { stdio: "inherit" },
    );
    if (ff.status !== 0) throw new Error("ffmpeg mux failed");

    console.log("done:", OUT);
  } finally {
    vite.kill();
    rmSync(workDir, { recursive: true, force: true });
  }
}

void main();
