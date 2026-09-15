import Link from "next/link";

/* A player's name, linked to their profile — where there is a profile.
 *
 * Only three pages in the app linked anywhere, and the community session page —
 * where most play actually happens — showed every name as plain text. Meanwhile
 * a profile grew a rating and how it was earned, an honours list, a partner
 * record and a skill chart. All of it was reachable only by typing a URL or
 * going the long way round through the roster.
 *
 * ── Why a component rather than a `<Link>` at each call site ─────────────
 * Because of the null case, which is easy to get wrong in the direction that
 * hurts. `players.personId` is null for anyone an organiser added without a
 * phone number: they exist inside that event and have no profile at all. A
 * `<Link href={`/people/${undefined}`}>` renders happily and 404s on click, and
 * nothing in a test would notice. Here a person with no id is plain text, once,
 * in one file.
 */
export function PersonLink({
  personId,
  name,
  className = "",
}: {
  personId: string | null | undefined;
  name: string;
  className?: string;
}) {
  if (!personId) return <span className={className}>{name}</span>;
  return (
    <Link href={`/people/${personId}`} className={`${className} hover:underline`.trim()}>
      {name}
    </Link>
  );
}
