import { launch, BASE } from './harness.mjs';
const B=BASE;
let fails=0; const ok=(c,m)=>{console.log((c?'  ok   ':'  FAIL ')+m); if(!c)fails++;};
const b=await launch();
const p=await b.newPage({viewport:{width:430,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,150));});
const txt=async(sel='body')=>(await p.textContent(sel)).replace(/\s+/g,' ');

console.log('\n== create a Pickleboss tournament ==');
await p.goto(B+'/new'); await p.waitForTimeout(500);
await p.fill('input[name="name"]','Friyayy Cup');
await p.check('input[value="pickleboss"]');
await p.click('button[type="submit"]');
await p.waitForURL(/\/manage/,{timeout:20000}); await p.waitForTimeout(500);
ok((await txt()).includes('Friyayy Cup'),'created and on the manage page');

console.log('\n== add 6 teams ==');
for(const n of ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot']){
  await p.fill('input[placeholder="New team name"]',n);
  await p.click('button:has-text("Add team")');
  await p.waitForTimeout(450);
}
const t1=await txt();
ok(['Alpha','Foxtrot'].every(n=>t1.includes(n)),'all six teams added');

console.log('\n== draw two groups ==');
await p.fill('input[name="groups"]','2');
await p.fill('input[name="courts"]','Court One, Court Two');
await p.click('button:has-text("Draw groups")');
await p.waitForTimeout(1800);
const t2=await txt();
ok(t2.includes('Group A')&&t2.includes('Group B'),'two groups created');
ok(t2.includes('Court One')&&t2.includes('Court Two'),'courts assigned per group');
ok(t2.includes('Standings'),'standings tables rendered');
const scoreLinks=await p.locator('a:has-text("Score")').count();
ok(scoreLinks===6,'6 group fixtures generated (2 groups of 3 = 3 each), got '+scoreLinks);

console.log('\n== score every group match ==');
let scored=0;
for(let guard=0; guard<30; guard++){
  // Find the first match row that is NOT yet final. Anchor on the row, then
  // look for its own Score link — filtering by an absolute locator matches
  // every row and silently returns the first one.
  const rows = await p.locator('li:has(a:text("Score"))').all();
  let target=null;
  for(const row of rows){
    const t=await row.textContent().catch(()=>'');
    if(!/·\s*final/.test(t)){ target=row; break; }
  }
  if(!target) break;
  await target.locator('a:text("Score")').click();
  await p.waitForURL(/\/score\//,{timeout:20000});
  await p.waitForSelector('[aria-label^="Point to"]',{timeout:20000});
  const half=p.locator('[aria-label^="Point to"]').first();
  for(let k=0;k<16;k++){
    if(await half.isDisabled().catch(()=>true)) break;
    await half.click().catch(()=>{});
    await p.waitForTimeout(120);
  }
  scored++;
  await p.goto(B+'/t/friyayy-cup/manage');
  await p.waitForTimeout(500);
}
// >= 6, not == 6: if a tap is lost the loop re-opens that match and finishes
// it, which is the harness self-healing rather than a fault.
ok(scored>=6,'scored all six group matches through the console (passes: '+scored+')');
await p.waitForTimeout(600);
const t3=await txt();
const finals=(t3.match(/final/gi)||[]).length;
ok(finals>=6,'all group matches show as final ('+finals+')');
ok(t3.includes('complete'),'a group reports itself complete');

console.log('\n== standings reflect the results ==');
const rowsA=await p.locator('table tbody tr').first().textContent();
ok(/\d/.test(rowsA),'standings rows carry numbers: '+rowsA.replace(/\s+/g,' ').trim().slice(0,60));

console.log('\n== draw and fill the knockout ==');
await p.fill('input[name="qualify"]','2');
await p.click('button:has-text("Draw knockout")');
await p.waitForTimeout(1500);
const t4=await txt();
ok(t4.includes('Semi-Final'),'semi-finals drawn');
ok(t4.includes('Final'),'final drawn');
ok(/group A #1|A1/.test(t4)||t4.includes('Winner'),'unfilled slots show where the team comes from');
await p.click('button:has-text("Fill resolved slots")');
await p.waitForTimeout(1500);
const t5=await txt();
ok(!/group [AB] #[12]/.test(t5),'group placings resolved into real teams');

console.log('\n== spectator page ==');
await p.goto(B+'/t/friyayy-cup'); await p.waitForTimeout(900);
const sp=await txt();
ok(sp.includes('Standings'),'spectator shows standings');
ok(sp.includes('Knockout'),'spectator shows the knockout');
ok(sp.includes('Pickleboss'),'format named');
await p.screenshot({path:'shot-event.png',fullPage:true});

/* The print pack. This tournament has two groups with every match scored, which
   is exactly the shape the sheets are for. Four rules were got wrong once in the
   single-file app; they are asserted here so they cannot regress. */
console.log('\n== print pack ==');
await p.goto(B+'/t/friyayy-cup/print'); await p.waitForTimeout(1200);
const perSheet=await p.$$eval('.psheet',ss=>ss.map(s=>({
  head:s.querySelector('.sport')?.textContent||'',
  fx:s.querySelectorAll('table.fx').length,
  mg:s.querySelectorAll('table.mg').length,
  caps:s.querySelectorAll('.cap').length,
})));
ok(perSheet.length===3,'one sheet per group plus the knockout, got '+perSheet.length);
/* The knockout sheet has one table per round but must still explain itself
   ONCE, not under each round. */
const koSheet=perSheet.find(s=>/Knockout/.test(s.head));
ok(koSheet&&koSheet.fx>1,'knockout has a table per round ('+(koSheet&&koSheet.fx)+')');
ok(koSheet&&koSheet.caps===1,'knockout caption appears once, not per round (got '+(koSheet&&koSheet.caps)+')');
const groupSheets=perSheet.filter(s=>/Group/.test(s.head));
ok(groupSheets.length===2,'two group sheets: '+groupSheets.map(s=>s.head).join(', '));
/* Matches are ROWS IN ONE TABLE, not a table each. */
ok(groupSheets.every(s=>s.fx===1),'each group has exactly one fixture table');
ok(groupSheets.every(s=>s.mg===1),'each group carries its margin grid');
/* The caption appears ONCE per table, not under every match. */
ok(groupSheets.every(s=>s.caps===2),'one caption per table, not per match');
/* No standings table — the margin grid already carries wins, diff and rank. */
ok(!(await txt()).includes('Standings'),'no standings table on the print pack');
/* The diagonal is found by POSITION: an unplayed match is null too, so testing
   the value would shade the wrong cell. */
const selfCells=await p.$$eval('td.self',es=>es.length);
ok(selfCells===6,'diagonal shaded by position (3 teams x 2 groups), got '+selfCells);
const gridText=await p.$eval('table.mg',t=>t.innerText.replace(/\n/g,' | '));
ok(/[+-]\d+/.test(gridText),'margins printed with sign: '+gridText.slice(0,90));

console.log('\n== print pack, blank ==');
await p.goto(B+'/t/friyayy-cup/print?blank=1'); await p.waitForTimeout(1200);
const blank=await p.$$eval('td.sbox',es=>es.map(e=>e.textContent.trim()));
ok(blank.length>0&&blank.every(t=>t===''),'every score box is blank to fill in by hand');
ok((await p.$$eval('td.self',es=>es.length))===6,'diagonals still shaded when blank');
ok((await txt()).includes('Alpha'),'team names still printed when blank');

/* Ratings are DERIVED from finished matches, never stored — this page is the
   proof the ported engine is wired to something at last.

   club-night rather than friyayy-cup because ratings are per PLAYER and the
   tournament built above has teams but no players. A match has to be FINISHED
   before anything moves, so finish one here rather than depending on the seed:
   on a fresh database none of the seeded matches is complete, and the
   assertions below would pass only on a database somebody had already scored
   by hand. */
console.log('\n== ratings ==');
await p.goto(B+'/t/club-night/manage'); await p.waitForTimeout(1000);
const cnLinks=await p.$$eval("a[href*='/score/']",as=>[...new Set(as.map(a=>a.getAttribute('href')))]);
let finished=false;
for(const href of cnLinks){
  await p.goto(B+href); await p.waitForTimeout(900);
  const names=await p.$$eval("button[aria-label^='Point to']",es=>es.map(e=>e.getAttribute('aria-label').replace('Point to ','')));
  if(names.length!==2) continue;
  /* Side-out scoring: only the serving side scores, so roughly two rallies per
     point. Tap one side until the buttons disable themselves. */
  for(let i=0;i<70;i++){
    const disabled=await p.$$eval("button[aria-label^='Point to']",es=>es.every(e=>e.disabled));
    if(disabled){ finished=true; break; }
    await p.click(`button[aria-label="Point to ${names[0]}"]`).catch(()=>{});
    await p.waitForTimeout(320);
  }
  if(finished) break;
}
ok(finished,'drove a club-night match to completion');

await p.goto(B+'/t/club-night/ratings'); await p.waitForTimeout(1200);
const rrows=await p.$$eval('tbody tr',rs=>rs.map(r=>[...r.children].map(c=>c.textContent.trim())));
ok(rrows.length>0,'ratings table has rows ('+rrows.length+')');
const dnum=r=>Number(String(r[4]).replace('—','0').replace('+',''));
const moved=rrows.filter(r=>dnum(r)!==0);
ok(moved.length>0,'at least one player moved: '+moved.map(r=>r[0]+' '+r[4]).join(', '));
/* The conservation property: one delta out of the losers, the same delta in. */
ok(rrows.reduce((s,r)=>s+dnum(r),0)===0,'movements sum to zero across the table');
ok(rrows.some(r=>/Beginner|Intermediate|Advanced|Pro|Elite/i.test(r[6])),'tier shown');

console.log('\n== errors ==');
const real=errs.filter(e=>!/favicon|net::ERR/.test(e));
ok(real.length===0,'no runtime errors: '+JSON.stringify(real.slice(0,3)));
await b.close();
console.log('\n'+(fails?fails+' FAILURES':'ALL PASS'));
process.exit(fails?1:0);
