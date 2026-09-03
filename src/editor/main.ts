import { SHEETS, SHEET_NAMES, type SheetName } from "../render/sheets";
import { Doc, type RGBA } from "./doc";
import { PALETTE, parseHex, toHex } from "./palette";
import { Preview } from "./preview";
import { downloadPng, saveToDisk } from "./save";
import { GridView, type Tool } from "./view";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const TOOLS: { id: Tool; key: string; label: string }[] = [
  { id: "pencil", key: "b", label: "✏ pencil" },
  { id: "eraser", key: "e", label: "⌫ eraser" },
  { id: "bucket", key: "g", label: "▉ fill" },
  { id: "rect", key: "u", label: "▭ rect" },
  { id: "picker", key: "i", label: "⊙ pick" },
];

class Editor {
  private docs = new Map<SheetName, Doc>();
  private doc!: Doc;
  private view!: GridView;
  private preview!: Preview;
  private color: RGBA = [26, 24, 22, 255];
  private row = 0;

  async start(): Promise<void> {
    this.buildSheetSelect();
    this.buildTools();
    this.buildPalette();
    this.bindToolbar();
    this.bindKeys();
    this.bindReferenceDrop();

    const first = SHEET_NAMES[0];
    this.doc = await this.getDoc(first);
    this.view = new GridView($<HTMLCanvasElement>("grid-canvas"), this.doc);
    this.preview = new Preview($<HTMLCanvasElement>("preview-canvas"), this.doc);

    this.view.onEdit = () => this.onEdit();
    this.view.onPickColor = (c) => this.setColor(c);
    this.view.onZoom = (z) => ($("zoom-val").textContent = `${z}×`);
    this.view.color = this.color;
    $("zoom-val").textContent = `${this.view.zoomLevel}×`;

    this.buildRows();
    this.setStatus("", "");
    window.addEventListener("beforeunload", (e) => {
      if ([...this.docs.values()].some((d) => d.dirty)) e.preventDefault();
    });
  }

  private async getDoc(name: SheetName): Promise<Doc> {
    let d = this.docs.get(name);
    if (!d) {
      d = await Doc.load(name);
      this.docs.set(name, d);
    }
    return d;
  }

  private async selectSheet(name: SheetName): Promise<void> {
    this.doc = await this.getDoc(name);
    this.row = 0;
    this.view.setDoc(this.doc);
    this.preview.setDoc(this.doc);
    this.preview.setRow(0);
    this.buildRows();
    this.refreshStatus();
  }

  // --- UI construction --------------------------------------------------

  private buildSheetSelect(): void {
    const sel = $<HTMLSelectElement>("sheet");
    for (const name of SHEET_NAMES) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      sel.append(o);
    }
    sel.addEventListener("change", () => {
      void this.selectSheet(sel.value as SheetName);
    });
  }

  private buildTools(): void {
    const host = $("tools");
    for (const t of TOOLS) {
      const btn = document.createElement("button");
      btn.textContent = t.label;
      btn.title = `${t.label} (${t.key})`;
      btn.dataset.tool = t.id;
      btn.addEventListener("click", () => this.setTool(t.id));
      host.append(btn);
    }
    this.setTool("pencil");
  }

  private buildPalette(): void {
    const host = $("palette");
    host.innerHTML = "";
    for (const sw of PALETTE) {
      const el = document.createElement("div");
      el.className = "swatch" + (sw.hex ? "" : " transparent");
      if (sw.hex) el.style.background = sw.hex;
      el.title = sw.name + (sw.hex ? ` ${sw.hex}` : "");
      const tag = document.createElement("span");
      tag.textContent = sw.name;
      el.append(tag);
      el.addEventListener("click", () => {
        this.setColor(sw.hex ? parseHex(sw.hex) : [0, 0, 0, 0]);
      });
      el.dataset.hex = sw.hex ?? "none";
      host.append(el);
    }
  }

  private buildRows(): void {
    const host = $("rows");
    host.innerHTML = "";
    SHEETS[this.doc.name].rows.forEach((r, i) => {
      const btn = document.createElement("button");
      btn.textContent = `${i}·${r.name}`;
      btn.classList.toggle("on", i === this.row);
      btn.addEventListener("click", () => {
        this.row = i;
        this.preview.setRow(i);
        this.buildRows();
      });
      host.append(btn);
    });
  }

  // --- toolbar / keys --------------------------------------------------

  private bindToolbar(): void {
    $("grid").addEventListener("change", (e) => {
      this.view.showGrid = (e.target as HTMLInputElement).checked;
      this.view.render();
    });
    $("guides").addEventListener("change", (e) => {
      this.view.showGuides = (e.target as HTMLInputElement).checked;
      this.view.render();
    });
    $<HTMLInputElement>("mix").addEventListener("input", (e) => {
      this.setColor(parseHex((e.target as HTMLInputElement).value));
    });
    $("play").addEventListener("change", (e) => {
      this.preview.playing = (e.target as HTMLInputElement).checked;
    });
    $("ref-alpha").addEventListener("input", (e) => {
      this.view.refAlpha = Number((e.target as HTMLInputElement).value) / 100;
      this.view.render();
    });
    $("undo").addEventListener("click", () => this.undo());
    $("redo").addEventListener("click", () => this.redo());
    $("revert").addEventListener("click", () => void this.revert());
    $("save").addEventListener("click", () => void this.save());
    $("download").addEventListener("click", () => downloadPng(this.doc));
    $("zoom-in").addEventListener("click", () => this.nudgeZoom(1.25));
    $("zoom-out").addEventListener("click", () => this.nudgeZoom(0.8));
    $("zoom-fit").addEventListener("click", () => this.view.fit());
  }

  private nudgeZoom(factor: number): void {
    const s = $("stage").getBoundingClientRect();
    this.view.setZoom(this.view.zoomLevel * factor, {
      x: s.left + s.width / 2,
      y: s.top + s.height / 2,
    });
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.save();
        return;
      }
      if (mod) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) this.setTool(t.id);
      if (e.key === "f") this.view.fit();
      if (e.key === "+" || e.key === "=") this.nudgeZoom(1.25);
      if (e.key === "-" || e.key === "_") this.nudgeZoom(0.8);
      if (e.key === "x" && this.lastSolid) this.setColor(this.lastSolid);
    });
  }

  private bindReferenceDrop(): void {
    const zone = $("ref-drop");
    const stop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    ["dragenter", "dragover"].forEach((n) =>
      zone.addEventListener(n, (e) => {
        stop(e as DragEvent);
        zone.classList.add("hot");
      }),
    );
    ["dragleave", "drop"].forEach((n) =>
      zone.addEventListener(n, (e) => {
        stop(e as DragEvent);
        zone.classList.remove("hot");
      }),
    );
    zone.addEventListener("drop", (e) => {
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (!file || !file.type.startsWith("image/")) return;
      const img = new Image();
      img.onload = () => {
        this.view.setReference(img);
        $("ref-name").textContent = file.name;
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // --- actions --------------------------------------------------------

  private lastSolid: RGBA | null = [26, 24, 22, 255];

  private setTool(id: Tool): void {
    if (this.view) this.view.tool = id;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#tools button")) {
      b.classList.toggle("on", b.dataset.tool === id);
    }
  }

  private setColor(c: RGBA): void {
    this.color = c;
    if (c[3] !== 0) {
      this.lastSolid = c;
      $<HTMLInputElement>("mix").value = toHex(c[0], c[1], c[2]);
    }
    if (this.view) this.view.color = c;
    const hex = c[3] === 0 ? "none" : toHex(c[0], c[1], c[2]);
    for (const el of document.querySelectorAll<HTMLElement>(".swatch")) {
      el.classList.toggle("sel", el.dataset.hex === hex);
    }
  }

  private onEdit(): void {
    this.view.render();
    this.refreshStatus();
  }

  private undo(): void {
    this.doc.undo();
    this.view.render();
    this.refreshStatus();
  }

  private redo(): void {
    this.doc.redo();
    this.view.render();
    this.refreshStatus();
  }

  private async revert(): Promise<void> {
    if (this.doc.dirty && !confirm(`discard unsaved edits to ${this.doc.name}?`)) {
      return;
    }
    this.docs.delete(this.doc.name);
    this.doc = await this.getDoc(this.doc.name);
    this.view.setDoc(this.doc);
    this.preview.setDoc(this.doc);
    this.refreshStatus();
  }

  private async save(): Promise<void> {
    if (!this.doc.dirty) {
      this.setStatus("nothing to save", "");
      return;
    }
    this.setStatus("saving…", "");
    try {
      await saveToDisk(this.doc);
      this.setStatus(`saved ${SHEETS[this.doc.name].file}`, "ok");
    } catch (err) {
      this.setStatus(String(err), "err");
    }
  }

  private refreshStatus(): void {
    const dirty = [...this.docs.values()].filter((d) => d.dirty).map((d) => d.name);
    this.setStatus(
      dirty.length ? `● unsaved: ${dirty.join(", ")}` : "saved",
      dirty.length ? "" : "ok",
    );
  }

  private setStatus(msg: string, cls: "" | "ok" | "err"): void {
    const el = $("status");
    el.textContent = msg;
    el.className = cls;
  }
}

void new Editor().start();
