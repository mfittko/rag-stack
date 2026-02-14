import { defineConfig } from "vitest/config";

const vitestConfig = defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});

export default vitestConfig;
