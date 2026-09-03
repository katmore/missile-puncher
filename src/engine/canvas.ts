import { SCREEN_W, SCREEN_H } from "../config";

/**
 * A fixed-size offscreen backbuffer (320x224) that every draw call targets,
 * blitted to the visible canvas at the largest integer scale that fits the
 * window, letterboxed and with image smoothing disabled.
 */
export class Display {
  readonly buffer: HTMLCanvasElement;
  readonly bctx: CanvasRenderingContext2D;
  private readonly screen: HTMLCanvasElement;
  private readonly sctx: CanvasRenderingContext2D;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  constructor(screen: HTMLCanvasElement) {
    this.screen = screen;
    this.sctx = must(screen.getContext("2d", { alpha: false }));

    this.buffer = document.createElement("canvas");
    this.buffer.width = SCREEN_W;
    this.buffer.height = SCREEN_H;
    this.bctx = must(this.buffer.getContext("2d", { alpha: false }));
    this.bctx.imageSmoothingEnabled = false;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;

    // Fractional, not floored: an integer-only scale sticks at 1x on a
    // landscape phone (e.g. iPhone ~844x390 -> min(2.6, 1.74) floors to 1),
    // so rotating never made the game bigger. imageSmoothingEnabled stays
    // false on this context, so the blit is still nearest-neighbor crisp.
    this.scale = Math.max(1, Math.min(cssW / SCREEN_W, cssH / SCREEN_H));

    const drawW = SCREEN_W * this.scale;
    const drawH = SCREEN_H * this.scale;

    this.screen.width = drawW * dpr;
    this.screen.height = drawH * dpr;
    this.screen.style.width = `${drawW}px`;
    this.screen.style.height = `${drawH}px`;

    this.sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sctx.imageSmoothingEnabled = false;
    this.offX = 0;
    this.offY = 0;
  }

  /** Copy the backbuffer to the screen. */
  present(): void {
    this.sctx.fillStyle = "#000";
    this.sctx.fillRect(
      0,
      0,
      this.screen.width,
      this.screen.height,
    );
    this.sctx.drawImage(
      this.buffer,
      this.offX,
      this.offY,
      SCREEN_W * this.scale,
      SCREEN_H * this.scale,
    );
  }
}

function must<T>(v: T | null): T {
  if (v == null) throw new Error("2d context unavailable");
  return v;
}
