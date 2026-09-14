"use client";

/* The bottom navigation, after the original RISE Sports app.
 *
 * There was none. Not a bar, not a sidebar, nothing — you reached the roster by
 * typing its URL and got back with the browser button. That is most of what
 * Faisal meant by "very bad to use", and it is the first thing being fixed.
 *
 * Shape is taken from the original (`D` in app.source.js:13062): a fixed bar,
 * icon above a small label, the current tab in the brand lime. Only the
 * destinations that EXIST are listed — a tab that goes nowhere is worse than a
 * missing one.
 *
 * Play joined on 2026-09-14 with the community port, Ledger the same day.
 * Venues deliberately has no tab of its own — it lives inside Play, as it does
 * in the original.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const TABS: Tab[] = [
  {
    href: "/",
    label: "Home",
    match: (p) => p === "/",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" {...stroke}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/play",
    label: "Play",
    match: (p) => p.startsWith("/play"),
    icon: (
      /* Two figures either side of a net — community play, not a trophy. */
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" {...stroke}>
        <path d="M12 3v18" />
        <circle cx="6" cy="7" r="2" />
        <path d="M4 19v-3a2 2 0 0 1 4 0v3" />
        <circle cx="18" cy="7" r="2" />
        <path d="M16 19v-3a2 2 0 0 1 4 0v3" />
      </svg>
    ),
  },
  {
    href: "/ledger",
    label: "Ledger",
    match: (p) => p.startsWith("/ledger"),
    icon: (
      /* A receipt, not a wallet — this is a record of who paid, and the app
         deliberately moves no money. */
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" {...stroke}>
        <path d="M6 3v18l2-1.5L10 21l2-1.5L14 21l2-1.5L18 21V3l-2 1.5L14 3l-2 1.5L10 3 8 4.5Z" />
        <path d="M9.5 8.5h5M9.5 12h5" />
      </svg>
    ),
  },
  {
    href: "/people",
    label: "Ratings",
    match: (p) => p.startsWith("/people"),
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" {...stroke}>
        <circle cx="12" cy="9" r="5" />
        <path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5" />
      </svg>
    ),
  },
  {
    href: "/new",
    label: "Create",
    match: (p) => p.startsWith("/new"),
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" {...stroke}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
];

export function NavBar() {
  const pathname = usePathname() ?? "/";

  /* The referee console is a full-screen surface held at arm's length
     courtside; a nav bar there is one mis-tap away from losing the match. */
  if (/^\/t\/[^/]+\/score\//.test(pathname)) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  active ? "text-amber-400" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {tab.icon}
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
