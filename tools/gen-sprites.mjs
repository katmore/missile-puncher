/**
 * Generates the ORIGINAL placeholder sprite sheets in src/assets/ as real PNG
 * files. Re-run after tweaking: `node tools/gen-sprites.mjs`
 *
 * Deliberately blocky, limited palette, late-NES / early-Genesis flavour.
 *
 * NOTE: day-to-day sprite work now happens in the in-repo pixel editor
 * (`npm run editor` -> saves straight to src/assets/). This script is the
 * from-scratch fallback — running it OVERWRITES whatever the editor produced.
 * Cell sizes / row order here must stay in sync with `src/render/sheets.ts`.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets");
mkdirSync(OUT, { recursive: true });

// ---- tiny PNG encoder (RGBA, 8-bit) -----------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- drawing surface -------------------------------------------------------
class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 4); // transparent
  }
  px(x, y, [r, g, b, a = 255]) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = r;
    this.buf[i + 1] = g;
    this.buf[i + 2] = b;
    this.buf[i + 3] = a;
  }
  rect(x, y, w, h, col) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, col);
  }
  save(name) {
    writeFileSync(join(OUT, name), encodePNG(this.w, this.h, this.buf));
    console.log("wrote", name, `${this.w}x${this.h}`);
  }
}

// ---- palette --------------------------------------------------------------
const OUTLINE = [26, 24, 22, 255];
const SKIN = [216, 160, 106, 255];
const HAIR = [92, 70, 52, 255];
const SHIRT_M = [74, 122, 58, 255]; // masc Puncher: desert green
const SHIRT_M_D = [52, 88, 40, 255];
const SHIRT_F = [156, 74, 52, 255]; // fem Puncher: rust / terracotta
const SHIRT_F_D = [116, 52, 36, 255];
const PANTS = [107, 90, 60, 255];
const BOOT = [58, 46, 34, 255];
const FIST = [230, 180, 120, 255];

const MISSILE_BODY = [180, 184, 190, 255];
const MISSILE_DARK = [120, 124, 132, 255];
const MISSILE_TIP = [200, 70, 60, 255];
const FLAME_A = [255, 210, 90, 255];
const FLAME_B = [255, 140, 50, 255];

const SHRUB = [110, 128, 74, 255];
const SHRUB_D = [78, 94, 52, 255];
const ROCK = [140, 132, 120, 255];
const ROCK_D = [104, 96, 86, 255];

// ---- puncher sheets: 6 rows x 4 cols, cell 24x40, one per selectable body --
const PW = 24;
const PH = 40;

// `hair` selects the look: "short" (masc-coded, green shirt) vs
// "long" (fem-coded, rust shirt). Body shape is identical between the two.
function drawPuncher(surf, cx, cy, { legs = 0, arm = "none", dead = false }, hair) {
  const o = (x, y, w, h, col) => surf.rect(cx + x, cy + y, w, h, col);
  const SHIRT = hair === "long" ? SHIRT_F : SHIRT_M;
  const SHIRT_D = hair === "long" ? SHIRT_F_D : SHIRT_M_D;

  if (dead) {
    o(2, 30, 20, 6, PANTS);
    o(1, 31, 22, 5, OUTLINE);
    o(2, 31, 20, 3, SHIRT);
    o(3, 27, 7, 7, OUTLINE);
    o(4, 28, 5, 5, SKIN); // head to the side
    if (hair === "long") {
      o(2, 26, 8, 4, HAIR); // hair fanned out on the ground
      o(1, 28, 6, 3, HAIR);
    } else {
      o(3, 26, 6, 3, HAIR);
    }
    return;
  }

  // hair mass behind the head (drawn first so the face sits on top)
  if (hair === "long") {
    o(5, 1, 6, 12, HAIR); // full volume around the skull
    o(6, 10, 5, 10, HAIR); // falls to below the shoulder (faces right)
    o(6, 19, 4, 3, HAIR); // blunt tips
  } else {
    o(7, 2, 2, 7, HAIR); // short nape
  }

  // head
  o(8, 2, 8, 8, OUTLINE);
  o(9, 3, 6, 6, SKIN);
  o(12, 5, 2, 2, OUTLINE); // eye, faces right

  // hair on top of / in front of the head
  if (hair === "long") {
    o(7, 0, 10, 3, HAIR); // wide crown
    o(7, 2, 2, 9, HAIR); // long lock down the jaw
    o(15, 2, 2, 7, HAIR); // sweep on the near side
  } else {
    o(8, 1, 8, 3, HAIR); // crown
    o(15, 3, 1, 3, HAIR); // short brow wisp
    o(8, 3, 1, 3, HAIR);
  }

  // torso
  o(7, 10, 10, 13, OUTLINE);
  o(8, 11, 8, 11, SHIRT);
  o(8, 16, 8, 2, SHIRT_D);

  // legs (two-frame walk sway)
  const l = legs === 1 ? 1 : legs === 2 ? -1 : 0;
  o(8, 23, 3, 12 + l, OUTLINE);
  o(9, 24, 2, 10 + l, PANTS);
  o(14, 23, 3, 12 - l, OUTLINE);
  o(15, 24, 2, 10 - l, PANTS);
  o(8, 34 + l, 4, 3, BOOT);
  o(14, 34 - l, 4, 3, BOOT);

  // back arm (tucked)
  o(6, 12, 3, 8, OUTLINE);
  o(7, 13, 2, 6, SHIRT);

  // long hair falls in front of the back shoulder
  if (hair === "long") {
    o(6, 11, 3, 10, HAIR);
    o(6, 20, 3, 2, HAIR);
  }

  // punching arm
  if (arm === "none") {
    o(16, 12, 3, 9, OUTLINE);
    o(17, 13, 2, 7, SHIRT);
  } else if (arm === "back") {
    o(4, 10, 4, 5, OUTLINE);
    o(5, 11, 3, 3, SKIN);
  } else if (arm === "mid") {
    o(16, 13, 7, 4, OUTLINE);
    o(17, 14, 6, 2, SHIRT);
    o(21, 12, 4, 5, OUTLINE);
    o(22, 13, 3, 3, FIST);
  } else if (arm === "full") {
    o(16, 13, 8, 4, OUTLINE);
    o(17, 14, 8, 2, SHIRT);
    o(23, 12, 1, 1, OUTLINE);
  }
}

const puncherRows = {
  idle: [{}, {}],
  walk: [{ legs: 1 }, {}, { legs: 2 }, {}],
  windup: [{ arm: "back" }],
  extension: [{ arm: "full" }],
  recovery: [{ arm: "mid" }],
  hitdead: [{ dead: true }, { dead: true }],
};

for (const [hair, file] of [
  ["short", "puncher-m.png"],
  ["long", "puncher-f.png"],
]) {
  const surf = new Canvas(PW * 4, PH * 6);
  ["idle", "walk", "windup", "extension", "recovery", "hitdead"].forEach(
    (name, r) => {
      puncherRows[name].forEach((opts, c) =>
        drawPuncher(surf, c * PW, r * PH, opts, hair),
      );
    },
  );
  surf.save(file);
}

// ---- missile sheet: 3 frames, cell 24x12 (body pointing left) -----------
const MW = 24;
const MH = 12;
const m = new Canvas(MW * 3, MH);
function drawMissile(cx, flame) {
  const o = (x, y, w, h, col) => m.rect(cx + x, y, w, h, col);
  // body: nose at left
  o(3, 4, 16, 4, OUTLINE);
  o(4, 5, 15, 2, MISSILE_BODY);
  o(4, 6, 15, 1, MISSILE_DARK);
  // nose cone
  o(2, 5, 2, 2, MISSILE_TIP);
  o(1, 5, 1, 2, OUTLINE);
  // tail fin
  o(18, 2, 3, 8, OUTLINE);
  o(19, 3, 2, 6, MISSILE_DARK);
  // exhaust
  if (flame === 1) {
    o(21, 5, 2, 2, FLAME_A);
  } else if (flame === 2) {
    o(21, 4, 3, 4, FLAME_B);
    o(21, 5, 2, 2, FLAME_A);
  }
}
drawMissile(0, 0);
drawMissile(MW, 1);
drawMissile(MW * 2, 2);
m.save("missile.png");

// ---- shrub sheet: 2 frames, cell 16x12 ---------------------------------
const SW = 16;
const SH = 12;
const s = new Canvas(SW * 2, SH);
// sagebrush
s.rect(6, 8, 4, 4, SHRUB_D);
for (const [x, y, w, h] of [
  [3, 5, 3, 4],
  [7, 3, 3, 5],
  [10, 5, 3, 4],
  [5, 6, 6, 3],
])
  s.rect(x, y, w, h, SHRUB);
s.rect(6, 9, 3, 3, SHRUB_D);
// rock
s.rect(SW + 3, 6, 10, 6, ROCK_D);
s.rect(SW + 4, 5, 8, 5, ROCK);
s.rect(SW + 6, 4, 4, 2, ROCK);
s.save("shrub.png");
