const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_EXE });
  const errors = [];
  const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
  const p = await ctx.newPage();
  p.on('pageerror', e=>errors.push('pageerror: '+e.message)); p.on('console', m=>{ if(m.type()==='error' && !/googleapis|fonts|ERR_TUNNEL/.test(m.text())) errors.push('console: '+m.text()); });
  await p.goto('http://localhost:3123/', { waitUntil:'load' }); await p.waitForTimeout(800);
  await p.screenshot({ path:'dev/ui-home.png', fullPage:true });
  await p.fill('#topic', 'AI automation'); await p.click('#run');
  await p.waitForURL(/\/r\//, { timeout: 15000 }); await p.waitForTimeout(1500);
  await p.screenshot({ path:'dev/ui-progress.png', fullPage:false });
  await p.waitForFunction(() => document.querySelector('.sigs'), null, { timeout: 40000 }); await p.waitForTimeout(500);
  await p.screenshot({ path:'dev/ui-radar.png', fullPage:true });
  await p.click('nav.tabs a[href="#platforms"]'); await p.waitForTimeout(400); await p.screenshot({ path:'dev/ui-platforms.png', fullPage:false });
  await p.click('nav.tabs a[href="#table"]'); await p.waitForTimeout(400); await p.screenshot({ path:'dev/ui-table.png', fullPage:false });
  // star a signal + open shortlist
  await p.click('nav.tabs a[href="#radar"]'); await p.waitForTimeout(300); await p.click('.sig .pin'); await p.click('#shortlist-btn'); await p.waitForTimeout(400); await p.screenshot({ path:'dev/ui-shortlist.png', fullPage:false });
  const sw = await p.evaluate(()=>document.documentElement.scrollWidth); if (sw>1400) errors.push('overflow desktop '+sw);
  // phone
  const ctx2 = await b.newContext({ viewport:{width:400,height:850}, colorScheme:'dark' }); const p2 = await ctx2.newPage();
  p2.on('pageerror', e=>errors.push('phone pageerror: '+e.message));
  await p2.goto(p.url(), { waitUntil:'load' }); await p2.waitForTimeout(1500);
  const sw2 = await p2.evaluate(()=>document.documentElement.scrollWidth); if (sw2>400) errors.push('overflow phone '+sw2);
  await p2.screenshot({ path:'dev/ui-phone.png', fullPage:false });
  console.log(errors.length ? errors.join('\n') : 'no errors', '| url', p.url());
  await b.close();
})();
