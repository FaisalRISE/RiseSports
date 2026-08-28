const fs = require('fs');
// pull the real shim out of app.source.js - test what ships, not a retyped copy
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.source.js'), 'utf8');
const start = src.indexOf('const PREFIX');
const end = src.indexOf('})();', start) + 5;
const shim = src.slice(start, end);
if (start < 0 || end < 5) { console.error('could not extract shim'); process.exit(1); }

function makeLS(seed) {
  const m = new Map(Object.entries(seed));
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)),
           _dump: () => Object.fromEntries(m) };
}
const run = seed => { const localStorage = makeLS(seed); eval(shim); return localStorage._dump(); };

let pass = 0, fail = 0;
const check = (name, cond, extra) => cond ? (pass++, console.log(`  PASS  ${name}`))
                                          : (fail++, console.log(`  FAIL  ${name}  ${extra||''}`));

console.log('migration shim');
let r = run({ pr9_pl: '[{"id":1}]', pr9_r: '4', pr9_venues: '[]' });
check('copies legacy keys to rs_', r.rs_pl === '[{"id":1}]' && r.rs_r === '4' && r.rs_venues === '[]');
check('leaves legacy keys intact', r.pr9_pl === '[{"id":1}]');
check('sets the migrated flag', r.rs_migrated === '1');
check('does not invent absent keys', !('rs_t' in r), JSON.stringify(Object.keys(r)));

r = run({ pr9_pl: '[OLD]', rs_pl: '[NEW]' });
check('never overwrites existing rs_ data', r.rs_pl === '[NEW]', r.rs_pl);

r = run({ pr9_pl: '[OLD]', rs_migrated: '1' });
check('is a no-op once flagged', !('rs_pl' in r));

r = run({});
check('empty storage is safe', r.rs_migrated === '1' && Object.keys(r).length === 1);

// a browser with storage disabled must not take the app down
const localStorage = { getItem(){ throw new Error('storage disabled'); },
                       setItem(){ throw new Error('storage disabled'); } };
let threw = false;
try { eval(shim); } catch (e) { threw = true; }
check('survives storage being disabled', !threw);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
