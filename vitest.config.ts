import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The sim modules (game / puncher / missile / effects) never touch the DOM;
    // headless playthrough tests just construct `Game` and step it. No browser.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
