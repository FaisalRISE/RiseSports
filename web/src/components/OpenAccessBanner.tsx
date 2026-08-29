import { OPEN_ACCESS } from "@/lib/auth/access";

/* Shown on every page while open access is on, so an unlocked deployment can
 * never be mistaken for a locked one. Renders nothing once RISE_OPEN_ACCESS=0. */
export function OpenAccessBanner() {
  if (!OPEN_ACCESS) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-amber-300"
    >
      Open access · testing mode — no PIN required, anyone can score
    </div>
  );
}
