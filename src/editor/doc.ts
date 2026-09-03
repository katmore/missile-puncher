import { SHEETS, type SheetName, sheetPixelW, sheetPixelH } from "../render/sheets";

export type RGBA = [number, number, number, number];

const HISTORY_CAP = 60;

/** Resolved URL for one PNG in `src/assets/` (used by the preview for props). */
export function assetUrl(file: string): string | undefined {
  return ASSET_URLS[file];
}

/** Resolved URLs for every PNG in `src/assets/`, keyed by bare filename. */
const ASSET_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../assets/*.png", {
      eager: true,
      query: "?url",
      import: "default",
    }) as Record<string, string>,
  ).map(([path, url]) => [path.split("/").pop()!, url]),
);

/**
 * One editable sheet: an RGBA pixel buffer the size of the PNG on disk, plus an
 * undo/redo stack of full-buffer snapshots (cheap at these resolutions — the
 * biggest sheet is 96x240 = ~92 KB).
 */
export class Doc {
  readonly name: SheetName;
  readonly w: number;
  readonly h: number;
  /** RGBA, row-major, `w * h * 4` bytes. */
  buf: Uint8ClampedArray;

  private undoStack: Uint8ClampedArray[] = [];
  private redoStack: Uint8ClampedArray[] = [];
  /** Buffer state as last saved to disk — drives the dirty indicator. */
  private savedHash = "";
  private pending: Uint8ClampedArray | null = null;

  private constructor(name: SheetName, buf: Uint8ClampedArray) {
    this.name = name;
    const def = SHEETS[name];
    this.w = sheetPixelW(def);
    this.h = sheetPixelH(def);
    this.buf = buf;
    this.savedHash = hash(buf);
  }

  /** Fetch the PNG currently on disk and read it into a buffer. */
  static async load(name: SheetName): Promise<Doc> {
    const def = SHEETS[name];
    const w = sheetPixelW(def);
    const h = sheetPixelH(def);
    const url = ASSET_URLS[def.file];
    if (!url) throw new Error(`no asset URL for ${def.file}`);
    // Cache-bust so a save -> reload cycle re-reads the fresh PNG.
    const buf = await readPng(`${url}?t=${Date.now()}`, w, h);
    return new Doc(name, buf);
  }

  get dirty(): boolean {
    return hash(this.buf) !== this.savedHash;
  }

  markSaved(): void {
    this.savedHash = hash(this.buf);
  }

  idx(x: number, y: number): number {
    return (y * this.w + x) * 4;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): RGBA {
    const i = this.idx(x, y);
    return [this.buf[i], this.buf[i + 1], this.buf[i + 2], this.buf[i + 3]];
  }

  /** Write a pixel. Call `begin()` before a stroke and `commit()` after. */
  set(x: number, y: number, c: RGBA): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.buf[i] = c[0];
    this.buf[i + 1] = c[1];
    this.buf[i + 2] = c[2];
    this.buf[i + 3] = c[3];
  }

  /** Snapshot the buffer so the next run of edits can be undone as one step. */
  begin(): void {
    this.pending = this.buf.slice();
  }

  /** Close an edit run opened with `begin()`, pushing it onto the undo stack. */
  commit(): void {
    if (!this.pending) return;
    if (hash(this.pending) === hash(this.buf)) {
      this.pending = null;
      return; // no-op stroke, don't pollute history
    }
    this.undoStack.push(this.pending);
    if (this.undoStack.length > HISTORY_CAP) this.undoStack.shift();
    this.redoStack.length = 0;
    this.pending = null;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.buf.slice());
    this.buf = prev;
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.buf.slice());
    this.buf = next;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  toImageData(): ImageData {
    return new ImageData(this.buf.slice(), this.w, this.h);
  }

  toDataURL(): string {
    const cv = document.createElement("canvas");
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext("2d")!;
    ctx.putImageData(this.toImageData(), 0, 0);
    return cv.toDataURL("image/png");
  }
}

/** FNV-1a over the buffer — fast, good enough to spot "did anything change". */
function hash(buf: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i += 137) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193);
  }
  // fold the tail in so trailing edits still register
  for (let i = Math.max(0, buf.length - 512); i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

async function readPng(
  url: string,
  w: number,
  h: number,
): Promise<Uint8ClampedArray> {
  const img = await loadImage(url);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}
