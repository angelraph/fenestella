import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: {
    alias: {
      "@fenestella/connect": path.resolve(import.meta.dirname, "packages/connect/src/index.ts"),
      "@": path.resolve(import.meta.dirname),
    },
  },
});
