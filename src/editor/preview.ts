import { CONFIG, SCREEN_W, SCREEN_H } from "../config";
import { drawBackground } from "../render/background";
import { SHEETS } from "../render/sheets";
import { assetUrl, type Doc } from "./doc";

/**
 * Live in-situ preview: the sheet's current row, animated at its real fps, drawn
 * where the thing actually appears in game (feet on `ground_y`, missile at
 * `missile_height`) over the real `drawBackground`. Plus a 1x filmstrip of every
 * frame in the row along the bottom.
 *
 * Pixels come from the in-memory `Doc`, so edits show without a save.
 */
export class Preview {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buf: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  /** The current sheet rasterised once per frame for drawImage sampling. */
  private frameCv = document.createElement("canvas");

  private doc: Doc;
  private row = 0;
  private t0 = performance.now();
  private raf = 0;
  playing = true;

  /** Real shrub PNG, for the background when another sheet is being edited. */
  private shrubImg: HTMLImageElement | null = null;
  /** Scratch canvas holding whichever image backs the background shrubs. */
  private shrubCv = document.createElement("canvas");

  constructor(canvas: HTMLCanvasElement, doc: Doc) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.doc = doc;
    this.buf = document.createElement("canvas");
    this.buf.width = SCREEN_W;
    this.buf.height = SCREEN_H;
    this.bctx = this.buf.getContext("2d")!;
    this.bctx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
    const url = assetUrl(SHEETS.shrub.file);
    if (url) {
      const img = new Image();
      img.onload = () => (this.shrubImg = img);
      img.src = `${url}?t=${Date.now()}`;
    }
    this.loop();
  }

  setDoc(doc: Doc): void {
    this.doc = doc;
    this.row = Math.min(this.row, SHEETS[doc.name].rows.length - 1);
    this.t0 = performance.now();
  }

  setRow(row: number): void {
    this.row = row;
    this.t0 = performance.now();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private loop = (): void => {
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private rasterise(): void {
    this.frameCv.width = this.doc.w;
    this.frameCv.height = this.doc.h;
    this.frameCv.getContext("2d")!.putImageData(this.doc.toImageData(), 0, 0);
  }

  private frameIndex(): number {
    const def = SHEETS[this.doc.name];
    const clip = def.rows[this.row];
    const elapsed = this.playing ? (performance.now() - this.t0) / 1000 : 0;
    const raw = Math.floor(elapsed * clip.fps);
    return clip.loop
      ? raw % clip.frames
      : Math.min(raw, clip.frames - 1);
  }

  private blitCell(
    col: number,
    dx: number,
    dy: number,
    flipX = false,
  ): void {
    const def = SHEETS[this.doc.name];
    const sx = col * def.cellW;
    const sy = this.row * def.cellH;
    const ctx = this.bctx;
    if (flipX) {
      ctx.save();
      ctx.translate(Math.round(dx) + def.cellW, Math.round(dy));
      ctx.scale(-1, 1);
      ctx.drawImage(this.frameCv, sx, sy, def.cellW, def.cellH, 0, 0, def.cellW, def.cellH);
      ctx.restore();
    } else {
      ctx.drawImage(
        this.frameCv,
        sx,
        sy,
        def.cellW,
        def.cellH,
        Math.round(dx),
        Math.round(dy),
        def.cellW,
        def.cellH,
      );
    }
  }

  private draw(): void {
    this.rasterise();
    const def = SHEETS[this.doc.name];
    const b = this.bctx;

    b.setTransform(1, 0, 0, 1, 0, 0);
    b.fillStyle = "#000";
    b.fillRect(0, 0, SCREEN_W, SCREEN_H);

    // Background shrubs: the live buffer when editing the shrub sheet, else the
    // real PNG loaded at construction.
    const sc = this.shrubCv.getContext("2d")!;
    this.shrubCv.width = SHEETS.shrub.cols * SHEETS.shrub.cellW;
    this.shrubCv.height = SHEETS.shrub.cellH;
    sc.clearRect(0, 0, this.shrubCv.width, this.shrubCv.height);
    if (this.doc.name === "shrub") {
      sc.drawImage(this.frameCv, 0, 0);
    } else if (this.shrubImg) {
      sc.drawImage(this.shrubImg, 0, 0);
    }
    drawBackground(b, {
      shrub: { img: this.shrubCv, cellW: SHEETS.shrub.cellW, cellH: SHEETS.shrub.cellH },
    } as never);

    const col = this.frameIndex();

    if (this.doc.name === "puncher-m" || this.doc.name === "puncher-f") {
      const dx = CONFIG.puncher_start_x - (def.cellW - CONFIG.puncher_width) / 2;
      const dy = CONFIG.ground_y - def.cellH + 4;
      this.blitCell(col, dx, dy);
      this.blitCell(col, dx + 70, dy, true); // a mirrored twin for facing check
    } else if (this.doc.name === "missile") {
      this.blitCell(col, SCREEN_W * 0.62 - def.cellW / 2, CONFIG.missile_height - def.cellH / 2);
    } else {
      // shrub: drop each frame along the ground line a few times
      const frames = def.rows[0].frames;
      [60, 130, 210, 270].forEach((x, i) =>
        this.blitCell(i % frames, x, CONFIG.ground_y - def.cellH + 1),
      );
    }

    // filmstrip of every frame in the row, 1x, bottom-left on a dark strip
    const stripH = def.cellH + 6;
    b.fillStyle = "rgba(0,0,0,0.55)";
    b.fillRect(0, SCREEN_H - stripH, SCREEN_W, stripH);
    for (let c = 0; c < def.rows[this.row].frames; c++) {
      const fx = 4 + c * (def.cellW + 4);
      b.strokeStyle = c === col ? "#ffd25a" : "rgba(255,255,255,0.25)";
      b.strokeRect(fx - 0.5, SCREEN_H - stripH + 2.5, def.cellW + 1, def.cellH + 1);
      this.blitCell(c, fx, SCREEN_H - stripH + 3);
    }

    // blit the 320x224 buffer to the visible canvas at integer scale
    const scale = Math.max(
      1,
      Math.floor(Math.min(this.cv.width / SCREEN_W, this.cv.height / SCREEN_H)),
    );
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = "#0a0a0c";
    this.ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    const ox = Math.floor((this.cv.width - SCREEN_W * scale) / 2);
    const oy = Math.floor((this.cv.height - SCREEN_H * scale) / 2);
    this.ctx.drawImage(this.buf, ox, oy, SCREEN_W * scale, SCREEN_H * scale);
  }
}
