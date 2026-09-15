import "server-only";

/* Tags OUTSIDE a person's own profile — the roster, and anywhere else a player
 * is listed rather than looked at.
 *
 * ── Why this is one function and not a query per screen ──────────────────
 * Because three rules have to hold on every surface, and a rule spread across
 * call sites is a rule that one of them will forget:
 *
 *   1. A person can switch their tags off (`people.hideTags`). Nothing in this
 *      app could take a tag down except the rater who left it, and putting
 *      other people's labels on a public list without a way to say no is how a
 *      word somebody else chose becomes permanent.
 *
 *   2. THREE different raters, or it does not leave the profile. One tick is
 *      attributable — a subject who plays with four people and sees "Hard
 *      Hitter 1" can usually name who said it — and one tick is also all it
 *      takes to farm, because identity is a cookie anyone can set
 *      (lib/community/me.ts). Three independent people saying the same thing is
 *      a different claim from one person saying it once.
 *
 *   3. No raw counts out here. A number invites a leaderboard of adjectives;
 *      the profile is where the detail belongs.
 *
 * ── And why tags never leave a screen without their sport ────────────────
 * Four of the fifteen strings — "Wall", "Consistent", "Clutch Player",
 * "Comeback Artist" — appear in all seven sports, and the rest mean different
 * things in different ones. A chip with no sport attached is ambiguous by
 * construction, so the roster only shows chips once a sport has been chosen.
 */

import { and, count, eq, inArray, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { people, skillEndorsements } from "@/lib/db/schema";
import type { SportId } from "@/lib/sports/registry";

/** Distinct raters needed before a tag is shown anywhere but the profile. */
export const PUBLIC_TAG_THRESHOLD = 3;

/** How many chips a list row carries. Past three it is a paragraph. */
export const CHIPS_PER_ROW = 3;

/**
 * Top tags per person, for a LIST.
 *
 * One grouped query for everybody on the page, never one per row — the same
 * shape the roster's event count already uses, and for the reason CLAUDE.md
 * records there: a correlated subquery in a `sql` template silently returned 0
 * for everyone.
 *
 * `count()` is drizzle's helper, which maps to Number. A hand-written
 * `sql<number>`count(*)`` returns a bigint as a STRING under postgres-js and a
 * number under PGlite — so it would pass every local test and be wrong only in
 * production.
 */
export async function topTagsFor(
  personIds: string[],
  sport: SportId,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (personIds.length === 0) return out;

  /* Who has asked to be left out. Read here rather than filtered by the caller,
     so a new surface cannot skip it by forgetting to join. */
  const hidden = new Set(
    (
      await db
        .select({ id: people.id })
        .from(people)
        .where(and(inArray(people.id, personIds), eq(people.hideTags, true)))
    ).map((r) => r.id),
  );

  const visible = personIds.filter((id) => !hidden.has(id));
  if (visible.length === 0) return out;

  const rows = await db
    .select({
      subject: skillEndorsements.subjectPersonId,
      tag: skillEndorsements.tag,
      raters: count(),
    })
    .from(skillEndorsements)
    .where(
      and(
        inArray(skillEndorsements.subjectPersonId, visible),
        eq(skillEndorsements.sport, sport),
      ),
    )
    .groupBy(skillEndorsements.subjectPersonId, skillEndorsements.tag)
    .having(gte(count(), PUBLIC_TAG_THRESHOLD));

  const bySubject = new Map<string, { tag: string; raters: number }[]>();
  for (const r of rows) {
    const list = bySubject.get(r.subject) ?? [];
    list.push({ tag: r.tag, raters: Number(r.raters) });
    bySubject.set(r.subject, list);
  }

  for (const [subject, list] of bySubject) {
    out.set(
      subject,
      list
        .sort((a, b) => b.raters - a.raters || a.tag.localeCompare(b.tag))
        .slice(0, CHIPS_PER_ROW)
        .map((t) => t.tag),
    );
  }
  return out;
}

/**
 * The predicate for "endorsed as this, in this sport".
 *
 * A correlated EXISTS rather than a join: a join against a row-per-rater table
 * multiplies the person row by the number of endorsements and would both
 * duplicate names and eat the hundred-row page. It also has to sit in the
 * WHERE, before the LIMIT — filtering in JavaScript afterwards would search
 * only the hundred highest-rated people and silently omit everybody below,
 * with no error and a list that still looks plausible.
 *
 * A person with `hideTags` is excluded here too, or the filter would find
 * somebody whose chips the list then refuses to draw.
 */
export const endorsedAs = (sport: SportId, tag: string) => sql`exists (
  select 1 from ${skillEndorsements} e
  where e.subject_person_id = ${people.id}
    and e.sport = ${sport}
    and e.tag = ${tag}
  group by e.subject_person_id
  having count(*) >= ${PUBLIC_TAG_THRESHOLD}
) and ${people.hideTags} = false`;
