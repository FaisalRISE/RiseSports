import { launch, BASE, createTournament } from './harness.mjs';
const B=BASE;
let fails=0; const ok=(c,m)=>{console.log((c?'  ok   ':'  FAIL ')+m); if(!c)fails++;};
const b=await launch();
const p=await b.newPage({viewport:{width:390,height:844}});
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});

console.log('\n== home ==');
await p.goto(B+'/'); await p.waitForTimeout(500);
const body=await p.textContent('body');
ok(body.includes('RISE Sports'),'home renders');
ok(body.includes('Thursday Club Night'),'seeded standard tournament listed');
ok(body.includes('Odyssey Sports League 2026'),'seeded OSL tournament listed');
ok(body.includes('Open access'),'open-access banner visible');
ok(!body.includes('database is not reachable'),'no db error');

console.log('\n== spectator ==');
await p.goto(B+'/t/osl-2026'); await p.waitForTimeout(400);
const spec=await p.textContent('body');
ok(spec.includes('Odyssey'),'OSL public page renders');
ok(/Pair [ABC]/.test(spec),'shows which pair is on court');
ok(spec.includes('Live')||spec.includes('Final'),'match states shown');

console.log('\n== referee console (OSL) ==');
await p.goto(B+'/t/osl-2026/manage'); await p.waitForTimeout(500);
const links=await p.locator('a:has-text("Score")').count();
ok(links>0,'manage page lists scoreable matches ('+links+')');
// open the match parked at 6-4 (one point from the Pair B rotation)
const rows=await p.locator('li').filter({hasText:'Group A'}).all();
let opened=false;
for(const r of rows){ const t=await r.textContent(); if(t.includes('6–4')){ await r.locator('a:has-text("Score")').click(); opened=true; break; } }
ok(opened,'found the match parked one point before the rotation');
await p.waitForURL(/\/score\//,{timeout:15000});
await p.waitForSelector('[aria-label^="Point to"]',{timeout:15000});
ok(await p.locator('.court, [aria-label^="Point to"]').count()>0 || (await p.textContent('body')).includes('Pair A'),'console renders');
const before=await p.textContent('body');
ok(before.includes('Pair A'),'Pair A on court at 6-4');
ok(before.includes('Serving'),'server marked');

console.log('\n== the blocking rotation ==');
const half=p.locator('[aria-label^="Point to"]').first();
await half.click(); await p.waitForTimeout(900);
const after=await p.textContent('body');
ok(after.includes('Pair B on court')||after.includes('7 reached'),'scoring the 7th point blocks with the Pair B confirmation');
// taps must be ignored while blocked
await half.click({force:true}); await p.waitForTimeout(500);
ok((await p.textContent('body')).includes('Pair B on court')||(await p.textContent('body')).includes('7 reached'),'further taps ignored while blocked');
await p.locator('button:has-text("resume play")').click(); await p.waitForTimeout(800);
const resumed=await p.textContent('body');
ok(!resumed.includes('resume play'),'confirming clears the block');
ok(resumed.includes('Pair B'),'Pair B now on court');

console.log('\n== undo re-arms the gate ==');
await p.locator('button:has-text("Undo last point")').click(); await p.waitForTimeout(800);
const undone=await p.textContent('body');
ok(undone.includes('Pair A'),'undo drops back to Pair A');

console.log('\n== golden point ==');
await p.goto(B+'/t/osl-2026/manage'); await p.waitForTimeout(500);
const semi=p.locator('li').filter({hasText:'Semi-Final'}).first();
await semi.locator('a:has-text("Score")').click(); await p.waitForTimeout(700);
ok((await p.textContent('body')).includes('Golden point'),'24-24 shows the golden point');

console.log('\n== create a tournament ==');
/* The wizard: sport card, format card, then the name. */
await createTournament(p,'E2E Test Cup',{sport:'Badminton',format:'Standard'});
ok(p.url().includes('/manage'),'create redirects to manage ('+p.url()+')');
ok((await p.textContent('body')).includes('E2E Test Cup'),'new tournament shown');

console.log('\n== add teams, players, a match ==');
for(const n of ['Alpha','Beta']){
  await p.fill('input[name="name"][placeholder="New team name"]',n);
  await p.click('button:has-text("Add team")'); await p.waitForTimeout(700);
}
const bodyTeams=await p.textContent('body');
ok(bodyTeams.includes('Alpha')&&bodyTeams.includes('Beta'),'both teams added');
const addPlayerForms=await p.locator('input[placeholder="Player name"]').count();
ok(addPlayerForms>=2,'per-team add-player forms rendered');
await p.locator('input[placeholder="Player name"]').first().fill('Ann');
await p.locator('form:has(input[placeholder="Player name"]) button:has-text("Add")').first().click();
await p.waitForTimeout(700);
ok((await p.textContent('body')).includes('Ann'),'player added');
const sel=p.locator('select[name="teamA"]');
await sel.selectOption({index:1});
await p.locator('select[name="teamB"]').selectOption({index:2});
await p.click('button:has-text("Add match")'); await p.waitForTimeout(900);
ok((await p.textContent('body')).includes('Alpha'),'match created');

console.log('\n== errors ==');
const real=errs.filter(e=>!/favicon|net::ERR/.test(e));
ok(real.length===0,'no runtime errors: '+JSON.stringify(real.slice(0,4)));
await p.goto(B+'/t/osl-2026'); await p.waitForTimeout(500);
await p.screenshot({path:'e2e-spectator.png',fullPage:true});
await p.goto(B+'/t/osl-2026/manage'); await p.waitForTimeout(500);
await p.screenshot({path:'e2e-manage.png',fullPage:true});
await b.close();
console.log('\n'+(fails?fails+' FAILURES':'ALL PASS'));
process.exit(fails?1:0);
