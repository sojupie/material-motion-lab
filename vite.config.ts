import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "web/main.ts",
      output: {
        entryFileNames: "assets/main.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
