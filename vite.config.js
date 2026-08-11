import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis", // prevents snarkjs "global is not defined" in-browser
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
  resolve: {
    alias: {
      buffer: "buffer",
    },
  },
});
