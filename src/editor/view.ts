import { SHEETS } from "../render/sheets";
import type { Doc, RGBA } from "./doc";

export type Tool = "pencil" | "eraser" | "bucket" | "rect" | "picker";

const TRANSPARENT: RGBA = [0, 0, 0, 0];
/** Sticky left strip that holds the row labels (screen px). */
const GUTTER = 64;
const MIN_ZOOM = 1;
const MAX_ZOOM = 40;

interface Cursor {
  x: number;
  y: number;
}

/**
 * The pixel grid.
 *
 * A `#sizer` div is stretched to the full sheet size so the `#stage` container
 * shows real scrollbars; the canvas is `position:sticky` and only ever
 * viewport-sized. Panning = native scroll (bars / trackpad / shift-wheel /
 * space-drag); the render offsets by `scrollLeft/Top`. Plain wheel zooms to the
 * cursor. Everything redraws from the buffer on any change — cheap.
 */
export class GridView {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scroller: HTMLElement;
  private sizer: HTMLElement;
  private doc: Doc;

  private zoom = 10;

  tool: Tool = "pencil";
  color: RGBA = [26, 24, 22, 255];
  showGrid = true;
  showGuides = true;

  private ref: HTMLImageElement | null = null;
  refAlpha = 0.35;

  private painting = false;
  private panning = false;
  private panFrom: { x: number; y: number; sl: number; st: number } | null = null;
  private lastCursor: Cursor | null = null;
  private rectAnchor: Cursor | null = null;
  private rectHover: Cursor | null = null;
  private spaceHeld = false;

  onEdit: () => void = () => {};
  onPickColor: (c: RGBA) => void = () => {};
  onCursor: (c: Cursor | null) => void = () => {};
  onZoom: (z: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement, doc: Doc) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.sizer = canvas.parentElement!;
    this.scroller = this.sizer.parentElement!;
    this.doc = doc;
    this.bind();
    this.fit();
  }

  get zoomLevel(): number {
    return this.zoom;
  }

  setDoc(doc: Doc): void {
    this.doc = doc;
    this.rectAnchor = null;
    this.fit();
  }

  setReference(img: HTMLImageElement | null): void {
    this.ref = img;
    this.render();
  }

  /** Zoom so the whole sheet fits the viewport, scrolled to the top-left. */
  fit(): void {
    const availW = this.scroller.clientWidth - GUTTER - 12;
    const availH = this.scroller.clientHeight - 12;
    const z = Math.floor(Math.min(availW / this.doc.w, availH / this.doc.h));
    this.zoom = Math.max(3, Math.min(MAX_ZOOM, z || 3));
    this.applySize();
    this.scroller.scrollTo(0, 0);
    this.render();
    this.onZoom(this.zoom);
  }

  /** @param anchor client-space point to keep stationary (e.g. the cursor). */
  setZoom(next: number, anchor: { x: number; y: number } | null): void {
    next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(next)));
    if (next === this.zoom) return;

    const a = anchor ?? this.viewportCentre();
    const doc = this.toDoc(a); // doc pixel under the anchor, pre-zoom
    this.zoom = next;
    this.applySize();

    // put that same doc pixel back under the anchor
    const sr = this.scroller.getBoundingClientRect();
    this.scroller.scrollLeft =
      GUTTER + (doc.x + 0.5) * next - (a.x - sr.left);
    this.scroller.scrollTop = (doc.y + 0.5) * next - (a.y - sr.top);

    this.render();
    this.onZoom(this.zoom);
  }

  private viewportCentre(): { x: number; y: number } {
    const sr = this.scroller.getBoundingClientRect();
    return { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
  }

  private applySize(): void {
    const dpr = window.devicePixelRatio || 1;
    // sizer drives the scrollbars: full sheet + the sticky gutter
    this.sizer.style.width = `${GUTTER + this.doc.w * this.zoom}px`;
    this.sizer.style.height = `${this.doc.h * this.zoom}px`;
    // canvas only ever needs to cover the visible viewport
    const vw = this.scroller.clientWidth;
    const vh = this.scroller.clientHeight;
    this.cv.style.width = `${vw}px`;
    this.cv.style.height = `${vh}px`;
    this.cv.width = Math.round(vw * dpr);
    this.cv.height = Math.round(vh * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  // --- coordinate mapping ----------------------------------------------

  /** client point -> doc pixel (accounts for scroll + gutter). */
  private toDoc(pt: { x: number; y: number }): Cursor {
    const sr = this.scroller.getBoundingClientRect();
    const contentX = pt.x - sr.left + this.scroller.scrollLeft - GUTTER;
    const contentY = pt.y - sr.top + this.scroller.scrollTop;
    return {
      x: Math.floor(contentX / this.zoom),
      y: Math.floor(contentY / this.zoom),
    };
  }

  // --- input ----------------------------------------------------------

  private bind(): void {
    this.cv.addEventListener("pointerdown", (e) => this.onDown(e));
    this.cv.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    this.cv.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.cv.addEventListener("contextmenu", (e) => e.preventDefault());
    this.scroller.addEventListener("scroll", () => this.render());
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        this.spaceHeld = true;
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") this.spaceHeld = false;
    });
    window.addEventListener("resize", () => {
      this.applySize();
      this.render();
    });
  }

  private wantsPan(e: PointerEvent): boolean {
    return e.button === 1 || e.button === 2 || this.spaceHeld;
  }

  private onDown(e: PointerEvent): void {
    try {
      this.cv.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    if (this.wantsPan(e)) {
      this.panning = true;
      this.panFrom = {
        x: e.clientX,
        y: e.clientY,
        sl: this.scroller.scrollLeft,
        st: this.scroller.scrollTop,
      };
      return;
    }
    const c = this.toDoc({ x: e.clientX, y: e.clientY });
    if (this.tool === "picker") {
      this.pick(c);
      return;
    }
    if (this.tool === "rect") {
      this.rectAnchor = c;
      this.rectHover = c;
      this.render();
      return;
    }
    this.painting = true;
    this.doc.begin();
    if (this.tool === "bucket") {
      this.flood(c);
      this.doc.commit();
      this.painting = false;
      this.onEdit();
      this.render();
      return;
    }
    this.lastCursor = c;
    this.plot(c);
    this.render();
  }

  private onMove(e: PointerEvent): void {
    const c = this.toDoc({ x: e.clientX, y: e.clientY });
    this.onCursor(this.doc.inBounds(c.x, c.y) ? c : null);

    if (this.panning && this.panFrom) {
      this.scroller.scrollLeft = this.panFrom.sl - (e.clientX - this.panFrom.x);
      this.scroller.scrollTop = this.panFrom.st - (e.clientY - this.panFrom.y);
      return;
    }
    if (this.rectAnchor) {
      this.rectHover = c;
      this.render();
      return;
    }
    if (!this.painting || !this.lastCursor) return;
    this.line(this.lastCursor, c, (p) => this.plot(p));
    this.lastCursor = c;
    this.render();
  }

  private onUp(e: PointerEvent): void {
    if (this.cv.hasPointerCapture(e.pointerId)) {
      this.cv.releasePointerCapture(e.pointerId);
    }
    if (this.panning) {
      this.panning = false;
      this.panFrom = null;
      return;
    }
    if (this.rectAnchor && this.rectHover) {
      this.doc.begin();
      this.strokeRect(this.rectAnchor, this.rectHover);
      this.doc.commit();
      this.rectAnchor = null;
      this.rectHover = null;
      this.onEdit();
      this.render();
      return;
    }
    if (this.painting) {
      this.painting = false;
      this.lastCursor = null;
      this.doc.commit();
      this.onEdit();
    }
  }

  private onWheel(e: WheelEvent): void {
    if (e.shiftKey) return; // shift-wheel: let the container scroll
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = this.zoom + dir * Math.max(1, Math.round(this.zoom * 0.2));
    this.setZoom(next, { x: e.clientX, y: e.clientY });
  }

  // --- editing primitives --------------------------------------------

  private activePaint(): RGBA {
    return this.tool === "eraser" ? TRANSPARENT : this.color;
  }

  private plot(c: Cursor): void {
    this.doc.set(c.x, c.y, this.activePaint());
  }

  private pick(c: Cursor): void {
    if (!this.doc.inBounds(c.x, c.y)) return;
    const p = this.doc.get(c.x, c.y);
    this.onPickColor(p[3] === 0 ? TRANSPARENT : p);
  }

  private strokeRect(a: Cursor, b: Cursor): void {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    const paint = this.activePaint();
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) this.doc.set(x, y, paint);
    }
  }

  private flood(c: Cursor): void {
    if (!this.doc.inBounds(c.x, c.y)) return;
    const target = this.doc.get(c.x, c.y);
    const paint = this.activePaint();
    if (sameRGBA(target, paint)) return;
    const stack: Cursor[] = [c];
    const seen = new Set<number>();
    while (stack.length) {
      const p = stack.pop()!;
      if (!this.doc.inBounds(p.x, p.y)) continue;
      const key = p.y * this.doc.w + p.x;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!sameRGBA(this.doc.get(p.x, p.y), target)) continue;
      this.doc.set(p.x, p.y, paint);
      stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y });
      stack.push({ x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
    }
  }

  private line(a: Cursor, b: Cursor, visit: (p: Cursor) => void): void {
    let x0 = a.x;
    let y0 = a.y;
    const dx = Math.abs(b.x - x0);
    const dy = -Math.abs(b.y - y0);
    const sx = x0 < b.x ? 1 : -1;
    const sy = y0 < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      visit({ x: x0, y: y0 });
      if (x0 === b.x && y0 === b.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  // --- rendering ----------------------------------------------------

  render(): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const vw = this.cv.clientWidth;
    const vh = this.cv.clientHeight;
    const sx = this.scroller.scrollLeft;
    const sy = this.scroller.scrollTop;

    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = "#15161a";
    ctx.fillRect(0, 0, vw, vh);

    // everything below is in CONTENT space, shifted by the scroll offset
    ctx.save();
    ctx.translate(-sx, -sy);

    const dw = this.doc.w * z;
    const dh = this.doc.h * z;
    const ox = GUTTER;

    // transparency checkerboard
    const chk = 8;
    ctx.fillStyle = "#2a2c31";
    ctx.fillRect(ox, 0, dw, dh);
    ctx.fillStyle = "#232529";
    for (let y = 0; y < this.doc.h; y += chk) {
      for (let x = 0; x < this.doc.w; x += chk) {
        if ((x / chk + y / chk) % 2 === 0) continue;
        ctx.fillRect(ox + x * z, y * z, chk * z, chk * z);
      }
    }

    const tmp = document.createElement("canvas");
    tmp.width = this.doc.w;
    tmp.height = this.doc.h;
    tmp.getContext("2d")!.putImageData(this.doc.toImageData(), 0, 0);
    ctx.imageSmoothingEnabled = false;

    if (this.ref) {
      ctx.globalAlpha = this.refAlpha;
      ctx.drawImage(this.ref, ox, 0, dw, dh);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(tmp, ox, 0, dw, dh);

    if (this.showGrid && z >= 6) this.drawPixelGrid(ox, dw, dh, z);
    if (this.showGuides) this.drawCellGuides(ox, z);
    if (this.rectAnchor && this.rectHover) {
      this.drawRectPreview(ox, this.rectAnchor, this.rectHover, z);
    }

    ctx.restore();

    // sticky gutter with row labels (screen space, unaffected by scrollLeft)
    if (this.showGuides) this.drawGutter(z, sy, vh);
  }

  private drawPixelGrid(ox: number, dw: number, dh: number, z: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= this.doc.w; x++) {
      ctx.moveTo(ox + x * z + 0.5, 0);
      ctx.lineTo(ox + x * z + 0.5, dh);
    }
    for (let y = 0; y <= this.doc.h; y++) {
      ctx.moveTo(ox, y * z + 0.5);
      ctx.lineTo(ox + dw, y * z + 0.5);
    }
    ctx.stroke();
  }

  private drawCellGuides(ox: number, z: number): void {
    const ctx = this.ctx;
    const def = SHEETS[this.doc.name];

    ctx.strokeStyle = "rgba(120,180,255,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let cx = 0; cx <= this.doc.w; cx += def.cellW) {
      ctx.moveTo(ox + cx * z + 0.5, 0);
      ctx.lineTo(ox + cx * z + 0.5, this.doc.h * z);
    }
    for (let cy = 0; cy <= this.doc.h; cy += def.cellH) {
      ctx.moveTo(ox, cy * z + 0.5);
      ctx.lineTo(ox + this.doc.w * z, cy * z + 0.5);
    }
    ctx.stroke();

    // dim cells past a row's real frame count
    ctx.fillStyle = "rgba(10,10,12,0.55)";
    def.rows.forEach((row, r) => {
      for (let c = row.frames; c < def.cols; c++) {
        ctx.fillRect(ox + c * def.cellW * z, r * def.cellH * z, def.cellW * z, def.cellH * z);
      }
    });
  }

  private drawGutter(z: number, scrollTop: number, vh: number): void {
    const ctx = this.ctx;
    const def = SHEETS[this.doc.name];
    ctx.fillStyle = "#15161a";
    ctx.fillRect(0, 0, GUTTER, vh);
    ctx.font = "11px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    def.rows.forEach((row, r) => {
      const y = (r + 0.5) * def.cellH * z - scrollTop;
      if (y < -10 || y > vh + 10) return;
      ctx.fillStyle = "#9fb4d8";
      ctx.fillText(`${r}·${row.name}`, GUTTER - 6, y);
    });
  }

  private drawRectPreview(ox: number, a: Cursor, b: Cursor, z: number): void {
    const ctx = this.ctx;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x) + 1;
    const h = Math.abs(b.y - a.y) + 1;
    ctx.strokeStyle = "#ffd25a";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + x0 * z + 0.5, y0 * z + 0.5, w * z, h * z);
  }
}

function sameRGBA(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
