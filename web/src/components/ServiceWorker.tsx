"use client";

/* Registers the offline shell worker.
 *
 * The `?v=` carries the build id. That is not decoration: a browser only
 * installs a new worker when the SCRIPT URL or its bytes change, and `sw.js` is
 * static. Without the query the old worker would keep serving an old cache
 * after every deploy — the exact failure this project has already had once.
 *
 * Registration is skipped in development. A worker caching a dev build makes
 * changes appear not to take effect, which is a miserable thing to debug. */

import { useEffect } from "react";

export function ServiceWorker({ version }: { version: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const url = `/sw.js?v=${encodeURIComponent(version)}`;
    /* Errors are swallowed on purpose: an unavailable worker means no offline
       shell, which is a degraded experience, not a broken one. It must never
       take the page down with it. */
    navigator.serviceWorker.register(url, { scope: "/" }).catch(() => undefined);
  }, [version]);

  return null;
}
