import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Each DB test file creates and migrates its own database, and uploads run pdftotext.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
