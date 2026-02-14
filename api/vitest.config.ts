import { defineConfig } from "vitest/config";

const vitestConfig = defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});

export const VITEST_CONFIG = vitestConfig;
export default vitestConfig;
