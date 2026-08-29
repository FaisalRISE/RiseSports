import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* PGlite is a local-development driver: keep its WASM out of the bundle. */
  serverExternalPackages: ["@electric-sql/pglite"],
  /* config options here */
};

export default nextConfig;
