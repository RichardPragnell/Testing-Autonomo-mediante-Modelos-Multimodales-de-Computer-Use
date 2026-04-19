import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agentic-qa/harness-core": fileURLToPath(new URL("../harness-core/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
