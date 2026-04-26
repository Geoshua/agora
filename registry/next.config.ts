import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Standalone build emits a self-contained server in .next/standalone
  // suitable for slim Docker images. See Dockerfile for the bundling steps.
  output: "standalone",
};

export default nextConfig;
