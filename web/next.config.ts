import type { NextConfig } from "next";

/* The id that busts the service worker's cache on deploy. The commit sha is
   stable per deploy on Vercel; locally any changing value does the job. It is
   read by ServiceWorker.tsx and appended to the sw.js URL, because a browser
   only picks up a new worker when the script URL or its bytes change. */
const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now());

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  async headers() {
    return [
      {
        /* The worker script itself must never be cached, or a deploy cannot
           replace it and the ?v= trick above is defeated. */
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  /* PGlite is a local-development driver: keep its WASM out of the bundle. */
  serverExternalPackages: ["@electric-sql/pglite"],
  /* config options here */
};

export default nextConfig;
