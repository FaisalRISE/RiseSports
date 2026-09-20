/* Run the unit tests twice: once as UTC, once as India.
 *
 * Several bugs in this project only exist east of UTC — a session date stored a
 * day early, a floating match time converted, an age counted from a `Date` —
 * and every one of them passes in UTC, which is where most machines and every
 * CI runner sit. Running both is the only way either result means anything.
 *
 * A script rather than `TZ=… vitest run` in package.json, because that syntax
 * does not work in Windows' shell, and this project is developed on Windows. */

import { spawnSync } from "node:child_process";

let failed = false;
for (const tz of ["UTC", "Asia/Kolkata"]) {
  console.log(`\n── TZ=${tz} ──`);
  const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, TZ: tz },
  });
  if (run.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
