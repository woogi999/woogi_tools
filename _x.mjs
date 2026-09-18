import puppeteer from 'puppeteer-core';
const out = process.env.LOCALAPPDATA + '/Temp/claude/e--coding-projects-JJS-Tools/a387a150-e5ed-4f98-95b1-b21a60bcac80/scratchpad/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.evaluateOnNewDocument(() => { localStorage.setItem('woogi-lobby-woonopoly', JSON.stringify({ bots: 3, arson: true, winMode: 'share', quickStart: true })); });
await page.goto('http://localhost:4311/woonopoly', { waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,4000));
await page.reload({ waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,2500));
const rules = await page.$('.lobby-rules, .lobby-rule');
await page.evaluate(() => document.querySelector('.lobby-rule')?.scrollIntoView({ block: 'start' }));
await page.screenshot({ path: out + 'n-lobby.png' });
const clickText = async (txt) => { const h = await page.$$('button'); for (const b of h) { const t = await b.evaluate(e=>e.textContent.trim()); if (t.startsWith(txt) && !(await b.evaluate(e=>e.disabled))) { await b.click(); return true; } } return false; };
await clickText('Start');
await new Promise(r=>setTimeout(r,3000));
let shot = 0;
for (let i = 0; i < 500 && shot < 2; i++) {
  await new Promise(r=>setTimeout(r,400));
  if (await page.$('.poly-actions .poly-danger')) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: out + `n-arson-${shot}.png` });
    await clickText('Commit arson'); await new Promise(r=>setTimeout(r,600));
    await page.screenshot({ path: out + `n-arson-${shot}-confirm.png` });
    const hold = await page.$('.confirm-hold, [class*=hold]');
    if (hold) { const b = await hold.boundingBox(); await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down(); await new Promise(r=>setTimeout(r,1800)); await page.mouse.up(); }
    await new Promise(r=>setTimeout(r,2500));
    await page.screenshot({ path: out + `n-arson-${shot}-after.png` });
    shot++;
    continue;
  }
  if (await clickText('Pay') && false) continue;
  if (await clickText('Buy for')) continue;
  if (await clickText('Roll')) continue;
  if (await clickText('End turn')) continue;
  if (await clickText('Pay')) continue;
}
console.log('shots', shot, await page.evaluate(() => document.querySelector('.poly-hud')?.textContent));
await browser.close();
