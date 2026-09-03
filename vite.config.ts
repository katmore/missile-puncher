import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const ROOT = __dirname;
const ASSETS_DIR = resolve(ROOT, "src/assets");
const CONFIG_FILE = resolve(ROOT, "src/config.ts");

// A tiny "which build is this" stamp (portrait-only footer, see index.html /
// main.ts) — the short commit hash a build was made from, so a redeployed
// page is tellable from a stale cached one. Falls back gracefully outside a
// git checkout (e.g. a source tarball).
function buildStamp(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: ROOT })
      .toString()
      .trim();
    return sha;
  } catch {
    return "unknown";
  }
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => ok(b));
  });
}

/**
 * Dev-only endpoint the in-repo sprite editor (`editor.html`) POSTs to. Writes
 * a PNG straight into `src/assets/`, which Vite then hot-reloads into the game.
 * Filenames are locked to the existing `.png` files in that directory.
 */
function spriteSaver(): Plugin {
  return {
    name: "sprite-saver",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save-asset", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("POST only");
        }
        void readBody(req).then((body) => {
          try {
            const { file, dataUrl } = JSON.parse(body) as {
              file: string;
              dataUrl: string;
            };
            if (!/^[a-z0-9-]+\.png$/.test(file)) throw new Error("bad filename");
            const target = resolve(ASSETS_DIR, file);
            if (!target.startsWith(ASSETS_DIR + "/") || !existsSync(target)) {
              throw new Error(`not an existing asset: ${file}`);
            }
            const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
            writeFileSync(target, Buffer.from(b64, "base64"));
            server.config.logger.info(`[sprite-saver] wrote src/assets/${file}`);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err instanceof Error ? err.message : err));
          }
        });
      });
    },
  };
}

const lit = (v: unknown): string =>
  typeof v === "string" ? JSON.stringify(v) : String(v);

/** JSON array of strings, formatted `["a", "b"]` (key names never contain `,`). */
const strArr = (v: string[]): string =>
  `[${v.map((s) => JSON.stringify(s)).join(", ")}]`;

/**
 * Dev-only endpoint the config tuner (`tuner.html`) POSTs to. Rewrites values
 * in `src/config.ts` in place — scalars by surgical line replacement (comments
 * kept), and the three structural literals (`bg.mountains`, `bg.shrubs`,
 * `keys`) regenerated whole. Nothing else in the repo is touched.
 */
function configTuner(): Plugin {
  return {
    name: "config-tuner",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save-config", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("POST only");
        }
        void readBody(req).then((body) => {
          try {
            const patch = JSON.parse(body) as {
              scalars?: Record<string, string | number | boolean>;
              mountains?: Array<Record<string, unknown>>;
              shrubs?: Array<[number, number]>;
              keys?: Record<string, string[]>;
            };
            let src = readFileSync(CONFIG_FILE, "utf8");
            const applied: string[] = [];
            const skipped: string[] = [];

            for (const [key, value] of Object.entries(patch.scalars ?? {})) {
              const name = key.split(".").pop()!;
              const re = new RegExp(
                `^(\\s*${name}:\\s*)(.+?)(,)(\\s*//.*)?$`,
                "m",
              );
              if (!re.test(src)) {
                skipped.push(key);
                continue;
              }
              src = src.replace(re, (_m, pre, _old, comma, cmt) =>
                `${pre}${lit(value)}${comma}${cmt ?? ""}`,
              );
              applied.push(key);
            }

            if (patch.mountains) {
              const rows = patch.mountains
                .map(
                  (m) =>
                    `      { color: ${JSON.stringify(m.color)}, base: ${m.base}, height: ${m.height}, period: ${m.period}, phase: ${m.phase} },`,
                )
                .join("\n");
              const block = `    mountains: [\n${rows}\n    ] as Array<{\n      color: string;\n      base: number;\n      height: number;\n      period: number;\n      phase: number;\n    }>,`;
              const re = / {4}mountains: \[[\s\S]*?\n {4}\] as Array<\{[\s\S]*?\n {4}\}>,/;
              if (re.test(src)) {
                src = src.replace(re, block);
                applied.push("bg.mountains");
              } else skipped.push("bg.mountains");
            }

            if (patch.shrubs) {
              const rows = patch.shrubs
                .map(([x, f]) => `      [${x}, ${f}],`)
                .join("\n");
              const block = `    shrubs: [\n${rows}\n    ] as Array<[number, 0 | 1]>,`;
              const re = / {4}shrubs: \[[\s\S]*?\n {4}\] as Array<\[number, 0 \| 1\]>,/;
              if (re.test(src)) {
                src = src.replace(re, block);
                applied.push("bg.shrubs");
              } else skipped.push("bg.shrubs");
            }

            if (patch.keys) {
              const rows = Object.entries(patch.keys)
                .map(([k, v]) => `    ${k}: ${strArr(v)} as string[],`)
                .join("\n");
              const block = `  keys: {\n${rows}\n  },`;
              const re = / {2}keys: \{[\s\S]*?\n {2}\},/;
              if (re.test(src)) {
                src = src.replace(re, block);
                applied.push("keys");
              } else skipped.push("keys");
            }

            writeFileSync(CONFIG_FILE, src);
            server.config.logger.info(
              `[config-tuner] wrote src/config.ts (${applied.length} fields)`,
            );
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, applied, skipped }));
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err instanceof Error ? err.message : err));
          }
        });
      });
    },
  };
}

/**
 * Writes `dist/version.txt` — the same short commit hash baked into
 * `__BUILD_STAMP__` — as a tiny standalone file the running page can poll
 * with `cache: "no-store"` to notice a new deploy (see `main.ts`). It has to
 * live outside `index.html` / the JS bundle: those are exactly what a stale
 * cache (GitHub Pages' CDN, Safari, or — worst offender — an iOS "Add to
 * Home Screen" standalone app, which barely re-checks at all) is serving
 * from, so re-fetching them proves nothing.
 */
function versionFile(stamp: string): Plugin {
  return {
    name: "version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.txt", source: stamp });
    },
  };
}

// `SINGLEFILE=1 vite build` (→ `npm run demo`) inlines everything — JS, CSS and
// the sprite PNGs (as data URIs) — into one self-contained `dist/index.html`
// you can email, drop on itch.io / Netlify, or open anywhere.
const oneFile = process.env.SINGLEFILE === "1";

const stamp = buildStamp();

export default defineConfig(({ command }) => ({
  base: "./",
  define: {
    __BUILD_STAMP__: JSON.stringify(stamp),
  },
  plugins: [
    spriteSaver(),
    configTuner(),
    versionFile(stamp),
    ...(oneFile ? [viteSingleFile()] : []),
  ],
  server: { open: true },
  build: {
    target: "es2022",
    assetsInlineLimit: oneFile ? 1_000_000 : 4096, // inline the PNGs for one-file
    // editor.html / tuner.html are dev-only tooling — keep them out of any build.
    rollupOptions:
      command === "build" ? { input: resolve(ROOT, "index.html") } : undefined,
  },
}));
