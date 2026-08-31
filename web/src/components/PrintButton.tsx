"use client";

/* The only client code on the print page. It calls window.print() and nothing
 * else — every number on the sheet was computed on the server.
 *
 * Deliberately NOT window.open: popups are blocked on the phones organisers
 * actually carry, which is why the single-file app printed a hidden div rather
 * than opening a new window. Here the page itself is the printable thing, so
 * Ctrl/Cmd-P works identically and this button is a convenience. */

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-black text-amber-950 hover:bg-amber-300"
    >
      {label}
    </button>
  );
}
