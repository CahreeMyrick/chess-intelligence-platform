import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all API calls to your Express backend:
      "/bestmove": "http://localhost:8080",
      "/bookmove": "http://localhost:8080",
      "/puzzles": "http://localhost:8080",
      "/game": "http://localhost:8080",
      "/games": "http://localhost:8080",
    },
  },
});
