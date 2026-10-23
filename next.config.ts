import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal Node server for the Tauri-packaged desktop app (no system Node required).
  output: "standalone",
  // Local SQLite is read on every request. Cache Components would freeze
  // those route handlers at build time.
  cacheComponents: false,
  // The dev server is bound to every interface, and the browser calls it
  // 127.0.0.1. Without this, Next blocks the HMR socket and the page
  // never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [
      { source: "/groupe", destination: "/group", permanent: true },
      { source: "/cours", destination: "/prices", permanent: true },
      { source: "/personnages/:id", destination: "/characters/:id", permanent: true },
    ];
  },
};

export default nextConfig;
