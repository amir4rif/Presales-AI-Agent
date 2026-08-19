import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep local dev runs from creating root-level agent instruction files.
  agentRules: false,
};

export default nextConfig;
