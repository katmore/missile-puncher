import type { Doc } from "./doc";
import { SHEETS } from "../render/sheets";

/**
 * POST the sheet back to `src/assets/` via the dev-server middleware in
 * `vite.config.ts`. On success the game page (if open) hot-reloads the asset.
 * Throws with the server's message on failure so the caller can surface it.
 */
export async function saveToDisk(doc: Doc): Promise<void> {
  const res = await fetch("/__save-asset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file: SHEETS[doc.name].file,
      dataUrl: doc.toDataURL(),
    }),
  });
  if (!res.ok) throw new Error(`save failed (${res.status}): ${await res.text()}`);
  doc.markSaved();
}

/** Browser-download fallback — writes nothing to the repo. */
export function downloadPng(doc: Doc): void {
  const a = document.createElement("a");
  a.href = doc.toDataURL();
  a.download = SHEETS[doc.name].file;
  a.click();
}
