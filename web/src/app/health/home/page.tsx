import Home from "@/app/page";

/* The home page's own code, on a different route.
 *
 * Everything else is now measured on both sides of the split, and all of it
 * came back innocent:
 *
 *   rendering            /health            a page, no query      200 in 1.5s
 *   querying             /api/health/db     seven rungs           all pass
 *   querying in a page   /health/db         the same seven        200 in 1.49s
 *   the query builder    rungs 5-7          incl. this page's
 *                                           own first query       188ms
 *
 * So the pooler, the network, the region, the layout, the fonts, the render
 * path, raw SQL and drizzle's builder are all eliminated. What has not been
 * tested is the only other difference: every probe above is a route added
 * TODAY, and all six hanging pages — /, /people, /play, /ledger, /t/[slug],
 * /e/[slug] — predate the outage. That matters because /ledger shares no code
 * with the change the outage began with, yet hangs exactly like the rest, and
 * a fault in the page code cannot explain that.
 *
 * This route imports the home page component and renders it, so the CODE is
 * identical down to the import graph and only the route is new:
 *
 *   it renders  → the code is fine and the fault belongs to those routes as
 *                 Vercel built or serves them
 *   it hangs    → the code is at fault after all, and the search narrows to
 *                 what this page does beyond querying
 *
 * Delete once the answer is known — unlike /health and /health/db, a second
 * copy of a real page is not worth keeping.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomeOnANewRoute() {
  return <Home />;
}
