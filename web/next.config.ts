import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Web is purely read-only against the registry's public REST API.
  // No DB, no native deps, no external server packages.
};

export default nextConfig;
