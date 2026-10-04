import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "evals",
    include: ["test/**/*.test.ts", "template/**/*.test.ts"],
    // Rendering a PDF launches Chromium, and the eval test runs pdftotext on every case.
    testTimeout: 60_000,
  },
});
