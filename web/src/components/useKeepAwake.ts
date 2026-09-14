"use client";

import { useEffect } from "react";

/**
 * Hold the screen on while a referee is scoring.
 *
 * A phone that dims between rallies means a tap that only wakes the screen, and
 * a referee who cannot tell whether the point registered. Every browser that
 * refuses — Safari below 16.4, any insecure origin, a battery-saving phone —
 * simply carries on dimming, so this is a best-effort improvement and never a
 * dependency.
 *
 * The lock is re-taken on `visibilitychange`: the browser releases it whenever
 * the tab is hidden, including a screen the user locked themselves, and without
 * this the console would come back with no lock at all for the rest of the
 * match.
 */
export function useKeepAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock?.request) return;

    let sentinel: WakeLockSentinel | null = null;
    let dropped = false;

    const take = () => {
      if (dropped || document.visibilityState !== "visible") return;
      /* Rejections are swallowed deliberately: a refused wake lock is a dimmer
         screen, not a scoring failure, and an unhandled rejection here would
         surface as an error on a page that is working fine. */
      nav.wakeLock!.request("screen").then(
        (s) => {
          if (dropped) void s.release().catch(() => {});
          else sentinel = s;
        },
        () => {},
      );
    };

    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      dropped = true;
      document.removeEventListener("visibilitychange", take);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
