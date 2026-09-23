import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@jr/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@jr/director": resolve(__dirname, "packages/director/src/index.ts"),
      "@jr/harness": resolve(__dirname, "packages/harness/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node",
  },
});
