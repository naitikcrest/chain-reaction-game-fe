import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts:["bd5b-2402-a00-173-41a-2012-b6c4-4ed2-8a1a.ngrok-free.app"]
  }
});

