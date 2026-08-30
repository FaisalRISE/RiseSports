import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B='http://localhost:3111';
let fails=0; const ok=(c,m)=>{console.log((c?'  ok   ':'  FAIL ')+m); if(!c)fails++;};
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
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

console.log('\n== errors ==');
const real=errs.filter(e=>!/favicon|net::ERR/.test(e));
ok(real.length===0,'no runtime errors: '+JSON.stringify(real.slice(0,3)));
await b.close();
console.log('\n'+(fails?fails+' FAILURES':'ALL PASS'));
process.exit(fails?1:0);
