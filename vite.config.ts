import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  base: "/wejsciowkapp/",
  build: { outDir: "../dist", emptyOutDir: true },
  test: { include: ["src/**/*.test.ts"] },
} as any);
