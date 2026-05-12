import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // E2E tests spawn testagent subprocesses; running test files serially
    // avoids subprocess/transcript contention and keeps polling deterministic.
    fileParallelism: false,
  },
});
