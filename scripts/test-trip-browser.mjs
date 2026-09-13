import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createPublicKeyPayload, encryptPublicKeyDocument } from './lib/trip-crypto.mjs';

// All private-looking content below is synthetic. Actual trip data is never decrypted,
// saved, screenshotted, or printed by this test. Set PLAYWRIGHT_MODULE if not installed locally.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dates = Array.from({length:5}, (_,i)=>`2030-01-${String(i+1).padStart(2,'0')}`);
function report(locale) {
  const zh=locale==='zh', word=(en,cn)=>zh?cn:en;
  return {type:'research', heading:word('Fixture guide','测试指南'), summary:word('Synthetic guidance','测试指引'),status:'Static fixture',banner:'Fixture update',openLabel:'Open fixture',navigationLabel:'Notes',sourcesLabel:'Sources',sources:[],chapters:[],dailyGuide:{locale,finalized:true,safety:word('Distance reminder and accessible spray.','距离提醒及随手可取的喷雾。'),navigation:word('Download maps separately.','单独下载离线地图。'),days:dates.map((date,i)=>({date,shortLabel:word(`Day ${i+1}`,`第${i+1}天`),title:word(`Fixture day ${i+1}`,`测试第${i+1}天`),badge:i===3?word('LONGEST DRIVE DAY','车程最长的一天'):null,intro:word('Flexible target departure.','灵活的目标出发时间。'),facts:[[word('Departure','出发'),'08:00']],comfort:word('Keep it flexible.','保持灵活。'),routes:[],routeNote:'',details:[],weatherPoints:[{name:'Fixture point',lat:40,lon:-100}],fair:'Fixture fair',wet:'Fixture wet',caution:'Fixture caution',stops:['green','yellow','orange'].map((awareness,j)=>({title:word(`Fixture stop ${j+1}`,`测试景点${j+1}`),text:word('A deliberately long facility and parking description for small-screen layout verification.','用于小屏幕布局验证的较长设施与停车说明，不是真实行程。'),time:'Morning',drive:'15–30 min',duration:'45–90+ min',parking:word('Signed visitor parking; retry another legal stop if full','有标识的游客停车场；满位时去其他合法停靠点'),restroom:word('At reset point','补给点有'),food:word('Real meal','正餐'),gas:word('At reset point','补给点有'),priority:word('HIGH','高'),decision:word('Shorten if tired','疲倦则缩短'),fallback:word('Another legal stop','其他合法停靠点'),next:word('Next reset: food, fuel and restrooms','下一补给点：餐饮、燃油和洗手间'),awareness,reset:j===0,turnaround:j===2?word('Turn back if satisfied; continue only with energy.','尽兴则折返；体力好才继续。'):null}))}))}};
}
const base=Object.fromEntries(['zh','en'].map(locale=>[locale,{title:'Synthetic dashboard',verifiedLabel:'Fixture only',tabs:{timeline:'Timeline',budget:'Budget',yellowstone:'Guide',changes:'Changes'},alerts:[],alertsHeader:'Alerts',urgentLabel:'Open',settledWord:'Done',budget:[{cat:'Fixture',item:'A long synthetic budget item for layout checks',cost:'$1',policy:'Fixture policy with enough text to wrap on a narrow screen'}],phases:[{id:1,title:'Synthetic bookings',items:[]}],yellowstone:{sections:[]},changes:{title:'Changes',subtitle:'Fixture',cols:[],rows:[]}}]));
const password='synthetic-browser-test';
const payload=await createPublicKeyPayload(base,password);
const append={schemaVersion:1,operations:['zh','en'].map(locale=>({op:'append',locale,collection:'yellowstone.sections',value:report(locale)}))};
const merge={schemaVersion:1,operations:['zh','en'].map(locale=>({op:'merge',locale,collection:'yellowstone.sections',match:{type:'research'},set:{status:'Applied second encrypted overlay'}}))};
const resources=new Map([
 ['/trip/payload.json',payload],
 ['/trip/sync.json',{lastSynced:'2030-01-01T00:00:00Z',timeZone:'UTC',source:'Synthetic test'}],
 ['/trip/updates.json',{schemaVersion:1,updates:['fixture-a.json','fixture-b.json']}],
 ['/trip/updates/fixture-a.json',await encryptPublicKeyDocument(append,payload)],
 ['/trip/updates/fixture-b.json',await encryptPublicKeyDocument(merge,payload)]
]);
const mime={'.html':'text/html','.js':'application/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const root=resolve(new URL('..',import.meta.url).pathname);
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(resources.has(path)){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(resources.get(path)));return;}
 const file=resolve(root,'.'+(path==='/trip/'?'/trip/index.html':path));
 if(!file.startsWith(root+'/trip/')){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
}catch{res.writeHead(404);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let browser;
try {
 browser=await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();const errors=[];const external=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!r.url().startsWith(`http://127.0.0.1:${server.address().port}`)&&!r.url().startsWith('data:'))external.push(new URL(r.url()).origin);});
 await page.goto(`http://127.0.0.1:${server.address().port}/trip/`);
 await page.waitForFunction(()=>document.querySelector('#gate-btn')?.disabled===false);
 await page.fill('#gate-pw','incorrect');await page.click('#gate-btn');
 await page.waitForFunction(()=>document.querySelector('#gate-err')?.textContent.includes('Incorrect password'));
 await page.fill('#gate-pw',password);await page.click('#gate-btn');
 await page.waitForSelector('.daily-guide');
 await page.getByRole('button',{name:'Guide',exact:true}).click();
 await page.getByText('Applied second encrypted overlay',{exact:true}).waitFor();
 for(const width of [320,375,390,768,1280]) {
  await page.setViewportSize({width,height:900});
  for(const lang of ['English','中文']) {
   await page.getByRole('button',{name:lang,exact:true}).click();
   for(let i=0;i<5;i++) {
    await page.locator('.day-selector button').nth(i).click();
    assert.equal(await page.locator('.stop-card').count(),3);
    assert.equal(await page.locator('.reset-point').count(),1);
    assert.equal(await page.locator('.turnaround').count(),1);
    const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('#root *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>e.className).filter(Boolean).slice(0,5)}));
    assert.ok(overflow.document<=overflow.viewport,JSON.stringify(overflow));
   }
  }
  await page.getByRole('button',{name:'Budget',exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Guide',exact:true}).click();
 }
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.waitForFunction(()=>window.TripOffline?.getStatus().ready===true,{},{timeout:30000});
 const stored=await page.evaluate(async()=>({session:Object.keys(sessionStorage),local:Object.keys(localStorage),caches:await Promise.all((await caches.keys()).map(async name=>({name,urls:(await(await caches.open(name)).keys()).map(r=>new URL(r.url).pathname)})))}));
 assert.equal(stored.session.filter(k=>k.startsWith('tripData:')).length,0);
 assert.equal(stored.local.filter(k=>k.startsWith('tripData:')).length,0);
 assert.ok(stored.caches.every(c=>c.urls.every(u=>u.startsWith('/trip/'))));
 assert.deepEqual(external,[],'Core guide must not request external runtime assets');
 await context.setOffline(true);
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('#gate-btn')?.disabled===false);
 assert.equal(await page.locator('.daily-guide').count(),0,'Offline reload must require unlocking');
 await page.fill('#gate-pw',password);await page.click('#gate-btn');await page.waitForSelector('.daily-guide');
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'Guide',exact:true}).click();
 await page.getByText('Applied second encrypted overlay',{exact:true}).waitFor();
 await page.locator('summary').filter({hasText:'Live weather, roads'}).click();
 await page.getByText('Offline: weather, alerts, roads and eruption predictions cannot be refreshed. Any displayed results may be stale.',{exact:true}).waitFor();
 assert.ok(await page.getByRole('button',{name:'Check weather now',exact:true}).isDisabled());
 assert.ok((await page.locator('#trip-offline-status').textContent()).includes('Offline ready'));
 assert.deepEqual(errors,[]);
 console.log('Browser gates passed: synthetic v2 unlock/wrong-password, ordered append+merge overlays, 5 dates × 2 languages × 5 widths, budget overflow, no external runtime requests, encrypted-cache offline reload/unlock and stale/live labels.');
 await context.close();
} finally {await browser?.close();await new Promise(done=>server.close(done));}
