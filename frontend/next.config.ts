import type { NextConfig } from "next";

// Static export: Wails serves plain files and runs no Node server in the
// window, so there is no SSR — the whole app ships as static HTML/JS.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
