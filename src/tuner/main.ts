import { GROUPS, autoRange, type Control, type Field } from "./schema";

type Json = string | number | boolean | Json[] | { [k: string]: Json };

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const panel = $("#panel");
const statusEl = $("#status");
const iframe = $<HTMLIFrameElement>("#game");

/**
 * Working copy of the whole config. Seeded from the game frame's live `__CONFIG`
 * (NOT a static `import` of config.ts) so that saving — which rewrites
 * config.ts and makes Vite reload the frame — never reloads the tuner itself.
 */
let work: Record<string, Json> = {};

/** Dot-paths touched since load (drives Save payload + "changed" styling). */
const changed = new Set<string>();
/** path -> callback that re-reads `work` and repaints its control. */
const repaint = new Map<string, () => void>();

// --- live bridge to the game iframe -----------------------------------

let ready = false;
let built = false;
function gameWin(): (Window & {
  __CONFIG?: Record<string, Json>;
  __applyConfigPatch?: (p: string[], v: unknown) => void;
}) | null {
  try {
    return iframe.contentWindow as never;
  } catch {
    return null;
  }
}

function pushLive(path: string[], value: Json): void {
  if (!ready) return;
  gameWin()?.__applyConfigPatch?.(path, value);
}

function pushAll(): void {
  for (const g of GROUPS) {
    for (const f of g.fields) pushLive(f.path, getPath(work, f.path));
  }
  pushLive(["bg", "mountains"], getPath(work, ["bg", "mountains"]));
  pushLive(["bg", "shrubs"], getPath(work, ["bg", "shrubs"]));
  pushLive(["keys"], getPath(work, ["keys"]));
}

iframe.addEventListener("load", () => {
  ready = false;
  let tries = 0;
  const poll = setInterval(() => {
    const gw = gameWin();
    if (gw?.__applyConfigPatch && gw.__CONFIG) {
      clearInterval(poll);
      if (!built) {
        // first frame load: seed the working copy + build the panel
        work = JSON.parse(JSON.stringify(gw.__CONFIG)) as Record<string, Json>;
        build();
        built = true;
        setStatus("ready", "");
      }
      ready = true;
      pushAll(); // re-assert our values (e.g. after a save-triggered reload)
    } else if (++tries > 50) {
      clearInterval(poll);
      setStatus("game frame has no dev hook — is BUILD.mode 'dev'?", "err");
    }
  }, 80);
});

// --- path helpers ----------------------------------------------------

function getPath(obj: Record<string, Json>, path: string[]): Json {
  let cur: Json = obj;
  for (const k of path) cur = (cur as Record<string, Json>)[k];
  return cur;
}
function setPath(obj: Record<string, Json>, path: string[], value: Json): void {
  let cur = obj as Record<string, Json>;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i]] as Record<string, Json>;
  }
  cur[path[path.length - 1]] = value;
}

function edit(path: string[], value: Json): void {
  setPath(work, path, value);
  changed.add(path.join("."));
  pushLive(path, value);
  const row = document.querySelector(`[data-path="${path.join(".")}"]`);
  row?.classList.add("changed");
  markDirty();
}

// --- control builders -----------------------------------------------

function numberRow(field: Field, ctl: Extract<Control, { kind: "num" }>): HTMLElement {
  const row = baseRow(field);
  const value = () => getPath(work, field.path) as number;

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(ctl.min);
  range.max = String(ctl.max);
  range.step = String(ctl.step);

  const val = document.createElement("input");
  val.type = "number";
  val.step = String(ctl.step);
  val.className = "num";

  const sync = () => {
    range.value = String(value());
    val.value = String(round(value(), ctl.step));
  };
  const commit = (raw: number) => {
    const v = clamp(raw, ctl.min, Infinity);
    edit(field.path, ctl.step >= 1 ? Math.round(v) : v);
    sync();
  };
  range.addEventListener("input", () => commit(Number(range.value)));
  val.addEventListener("change", () => commit(Number(val.value)));

  row.append(range, wrap(val, "val"));
  repaint.set(field.path.join("."), sync);
  sync();
  return row;
}

function boolRow(field: Field): HTMLElement {
  const row = baseRow(field);
  const cb = document.createElement("input");
  cb.type = "checkbox";
  const sync = () => (cb.checked = getPath(work, field.path) as boolean);
  cb.addEventListener("change", () => edit(field.path, cb.checked));
  row.append(cb, document.createElement("span"));
  repaint.set(field.path.join("."), sync);
  sync();
  return row;
}

function colorRow(field: Field): HTMLElement {
  const row = baseRow(field);
  const picker = document.createElement("input");
  picker.type = "color";
  const hex = document.createElement("span");
  hex.className = "val";
  const sync = () => {
    const c = getPath(work, field.path) as string;
    picker.value = c;
    hex.textContent = c;
  };
  picker.addEventListener("input", () => {
    edit(field.path, picker.value);
    hex.textContent = picker.value;
  });
  row.append(picker, hex);
  repaint.set(field.path.join("."), sync);
  sync();
  return row;
}

function baseRow(field: Field): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.path = field.path.join(".");
  row.dataset.search = `${field.label} ${field.path.join(".")}`.toLowerCase();
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = field.label;
  lbl.title = field.path.join(".");
  row.append(lbl);
  return row;
}

function wrap(el: HTMLElement, cls: string): HTMLElement {
  const s = document.createElement("span");
  s.className = cls;
  s.append(el);
  return s;
}

// --- structural editors --------------------------------------------

function mountainsEditor(): HTMLElement {
  const box = document.createElement("div");
  const path = ["bg", "mountains"];
  const layers = () => getPath(work, path) as Array<Record<string, Json>>;

  const render = () => {
    box.innerHTML = "";
    const h2 = document.createElement("h2");
    h2.textContent = "background · mountain layers";
    box.append(h2);

    layers().forEach((layer, i) => {
      const card = document.createElement("div");
      card.className = "card";
      const head = document.createElement("div");
      head.className = "head";
      head.innerHTML = `<span>layer ${i} (back→front)</span>`;
      const del = document.createElement("button");
      del.className = "ghost";
      del.textContent = "remove";
      del.addEventListener("click", () => {
        const next = layers().slice();
        next.splice(i, 1);
        edit(path, next as Json);
        render();
      });
      head.append(del);
      card.append(head);

      const set = (k: string, v: Json) => {
        const next = layers().map((l, j) => (j === i ? { ...l, [k]: v } : l));
        edit(path, next as Json);
      };
      card.append(
        miniColor("color", layer.color as string, (v) => set("color", v)),
        miniNum("base", layer.base as number, 0, 60, 1, (v) => set("base", v)),
        miniNum("height", layer.height as number, 0, 120, 1, (v) => set("height", v)),
        miniNum("period", layer.period as number, 4, 160, 1, (v) => set("period", v)),
        miniNum("phase", layer.phase as number, 0, 160, 1, (v) => set("phase", v)),
      );
      box.append(card);
    });

    const add = document.createElement("button");
    add.className = "ghost";
    add.textContent = "+ add layer";
    add.addEventListener("click", () => {
      const next = layers().slice();
      next.push({ color: "#8a8296", base: 4, height: 20, period: 50, phase: 0 });
      edit(path, next as Json);
      render();
    });
    box.append(add);
  };
  render();
  return box;
}

function shrubsEditor(): HTMLElement {
  const box = document.createElement("div");
  const path = ["bg", "shrubs"];
  const list = () => getPath(work, path) as Array<[number, number]>;

  const render = () => {
    box.innerHTML = "";
    const h2 = document.createElement("h2");
    h2.textContent = "background · props (x, kind)";
    box.append(h2);
    list().forEach(([x, kind], i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.gridTemplateColumns = "1fr 1fr 52px";
      row.append(
        miniNum("x", x, 0, 320, 1, (v) => {
          const next = list().map((p, j) => (j === i ? [v, p[1]] : p));
          edit(path, next as Json);
        }),
      );
      const sel = document.createElement("select");
      sel.innerHTML = `<option value="0">sagebrush</option><option value="1">rock</option>`;
      sel.value = String(kind);
      sel.addEventListener("change", () => {
        const next = list().map((p, j) =>
          j === i ? [p[0], Number(sel.value)] : p,
        );
        edit(path, next as Json);
      });
      row.append(sel);
      const del = document.createElement("button");
      del.className = "ghost";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        const next = list().slice();
        next.splice(i, 1);
        edit(path, next as Json);
        render();
      });
      row.append(del);
      box.append(row);
    });
    const add = document.createElement("button");
    add.className = "ghost";
    add.textContent = "+ add prop";
    add.addEventListener("click", () => {
      const next = list().slice();
      next.push([160, 0]);
      edit(path, next as Json);
      render();
    });
    box.append(add);
  };
  render();
  return box;
}

function keysEditor(): HTMLElement {
  const box = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = "input map (comma-separated)";
  box.append(h2);
  const keys = getPath(work, ["keys"]) as Record<string, string[]>;
  for (const action of Object.keys(keys)) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.gridTemplateColumns = "80px 1fr";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = action;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = (keys[action] as string[]).join(", ");
    inp.addEventListener("change", () => {
      const arr = inp.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const next = { ...(getPath(work, ["keys"]) as object), [action]: arr };
      edit(["keys"], next as Json);
    });
    row.append(lbl, inp);
    box.append(row);
  }
  return box;
}

function miniNum(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  const l = document.createElement("span");
  l.className = "lbl";
  l.textContent = label;
  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  const val = document.createElement("span");
  val.className = "val";
  val.textContent = String(value);
  range.addEventListener("input", () => {
    val.textContent = range.value;
    onChange(Number(range.value));
  });
  row.append(l, range, val);
  return row;
}

function miniColor(
  label: string,
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  const l = document.createElement("span");
  l.className = "lbl";
  l.textContent = label;
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = value;
  const hex = document.createElement("span");
  hex.className = "val";
  hex.textContent = value;
  picker.addEventListener("input", () => {
    hex.textContent = picker.value;
    onChange(picker.value);
  });
  row.append(l, picker, hex);
  return row;
}

// --- build the panel ----------------------------------------------

function build(): void {
  for (const group of GROUPS) {
    const h2 = document.createElement("h2");
    h2.textContent = group.title;
    panel.append(h2);
    for (const field of group.fields) {
      const c = field.control;
      if (c.kind === "bool") {
        panel.append(boolRow(field));
      } else if (c.kind === "color") {
        panel.append(colorRow(field));
      } else {
        const raw = getPath(work, field.path);
        const ctl =
          typeof raw === "number" && raw > c.max
            ? (autoRange(raw) as Extract<Control, { kind: "num" }>)
            : c;
        panel.append(numberRow(field, ctl));
      }
    }
  }
  panel.append(mountainsEditor(), shrubsEditor(), keysEditor());

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "edits are live in the frame → · Save writes src/config.ts (comments kept for scalars; mountains / props / keys blocks regenerated). Revert = reload from disk.";
  panel.append(hint);
}

// --- filter / save ----------------------------------------------

$<HTMLInputElement>("#filter").addEventListener("input", (e) => {
  const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
  for (const row of document.querySelectorAll<HTMLElement>(".row[data-search]")) {
    row.classList.toggle("hidden", q !== "" && !row.dataset.search!.includes(q));
  }
});

$("#revert").addEventListener("click", () => {
  if (!changed.size || confirm("discard unsaved changes and reload?")) {
    location.reload();
  }
});

$("#save").addEventListener("click", () => void save());
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save();
  }
});

async function save(): Promise<void> {
  const scalarPaths = new Set<string>();
  for (const g of GROUPS) {
    for (const f of g.fields) scalarPaths.add(f.path.join("."));
  }
  const scalars: Record<string, Json> = {};
  let mountains: Json | undefined;
  let shrubs: Json | undefined;
  let keys: Json | undefined;
  for (const p of changed) {
    if (p === "bg.mountains") mountains = getPath(work, ["bg", "mountains"]);
    else if (p === "bg.shrubs") shrubs = getPath(work, ["bg", "shrubs"]);
    else if (p === "keys") keys = getPath(work, ["keys"]);
    else if (scalarPaths.has(p)) scalars[p] = getPath(work, p.split("."));
  }
  const nChanged =
    Object.keys(scalars).length +
    (mountains ? 1 : 0) +
    (shrubs ? 1 : 0) +
    (keys ? 1 : 0);
  if (!nChanged) {
    setStatus("nothing changed", "");
    return;
  }
  setStatus("saving…", "");
  try {
    const res = await fetch("/__save-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scalars, mountains, shrubs, keys }),
    });
    const out = (await res.json()) as { ok: boolean; applied: string[]; skipped: string[] };
    if (!res.ok || !out.ok) throw new Error(JSON.stringify(out));
    changed.clear();
    for (const r of document.querySelectorAll(".row.changed")) {
      r.classList.remove("changed");
    }
    setStatus(
      `wrote ${out.applied.length} field(s)` +
        (out.skipped.length ? ` · SKIPPED: ${out.skipped.join(", ")}` : ""),
      out.skipped.length ? "err" : "ok",
    );
  } catch (err) {
    setStatus(`save failed: ${err instanceof Error ? err.message : err}`, "err");
  }
}

function markDirty(): void {
  setStatus(`● ${changed.size} unsaved`, "");
}
function setStatus(msg: string, cls: "" | "ok" | "err"): void {
  statusEl.textContent = msg;
  statusEl.className = cls;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round(v: number, step: number): number {
  return step >= 1 ? Math.round(v) : Math.round(v / step) * step;
}

setStatus("loading game frame…", "");
