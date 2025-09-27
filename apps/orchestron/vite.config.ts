import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Path resolution
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
  },

  // Root directory for the web app
  root: path.resolve(__dirname, "web"),

  // Server configuration for development
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3002",
        ws: true,
      },
    },
  },

  // Build configuration
  build: {
    // Output directory (relative to root)
    outDir: "../dashboard",
    emptyOutDir: true,

    // Increase chunk size warning limit to 2000 KB
    chunkSizeWarningLimit: 2000,

    rollupOptions: {
      output: {
        // Manual chunks for better code splitting
        manualChunks: {
          // Vendor chunks
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-switch',
            '@radix-ui/react-popover'
          ],
          'editor-vendor': ['@uiw/react-md-editor'],
          'syntax-vendor': ['react-syntax-highlighter'],
          'utils': ['date-fns', 'clsx', 'tailwind-merge'],
        },
      },
    },
  },
});