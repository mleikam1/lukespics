import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    restoreMocks: true,
    exclude: ["lib/**", "node_modules/**"],
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
    },
  },
});
