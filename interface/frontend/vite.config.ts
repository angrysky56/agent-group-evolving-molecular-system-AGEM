import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if ("code" in err && err.code === "ECONNREFUSED") {
              if (res && "writeHead" in res && !("headersSent" in res && res.headersSent)) {
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(
                  JSON.stringify({
                    error: "Service Unavailable",
                    message:
                      "AGEM backend server is starting up or unreachable at 127.0.0.1:8000",
                  })
                );
              }
            }
          });
        },
      },
    },
  },
});
