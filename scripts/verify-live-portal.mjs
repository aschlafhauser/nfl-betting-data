import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const canonical=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const podcast=await read('data/expert-podcast-process-current.json');
const podcastRecords=[];
for(const name of await fs.readdir('data/expert-episode-audit')){
 const audit=await read('data/expert-episode-audit/'+name);
 if(audit.season===canonical.season&&audit.week===canonical.week&&audit.transcriptStatus==='COMPLETE')podcastRecords.push(...(audit.materialRecords||[]));
}
const portal=await read('data/nfl-weekly-board.json');
const upcomingIds=new Set(canonical.games.filter(g=>g.eventState!=='final'&&Date.parse(g.dateTime)>Date.now()).map(g=>g.gameId));
const currentPodcast=podcastRecords.filter(r=>upcomingIds.has(r.game_id));
const expected=Number(process.env.NFL_EXPECTED_GAMES||canonical.games.length),week=Number(process.env.NFL_WEEK||canonical.week);
const browser=await chromium.launch({headless:true});
const report={week,expected,tabs:{},matchups:[],mobile:{},failures:[]};
const fail=message=>report.failures.push(message);
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>fail('pageerror: '+e.message));
 await page.goto(process.env.NFL_PORTAL_URL||'https://nfl-betting-intelligence.netlify.app/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(()=>/Governance|Production QC/.test(document.getElementById('boardStatus')?.textContent||'')&&document.querySelector('#nflSchemeStylePanel')&&document.querySelector('#propStatus')?.textContent.includes('recommendations'),null,{timeout:60000});
 const tabs=await page.locator('nav button[data-tab]').evaluateAll(xs=>xs.map(x=>({id:x.dataset.tab,name:x.textContent.trim()})));
 if(tabs.length!==13)fail('Navigation contains '+tabs.length+'/13 tabs');
 for(const t of tabs){
  await page.getByRole('button',{name:t.name,exact:true}).click();
  const section=page.locator('#'+t.id),text=(await section.innerText()).trim();
  report.tabs[t.id]={visible:await section.isVisible(),textLength:text.length};
  if(!report.tabs[t.id].visible||text.length<25)fail(t.name+' did not activate with content');
  if(/\bNaN\b|\bundefined\b/.test(text))fail(t.name+' contains invalid numeric/text values');
 }
 const status=await page.locator('#boardStatus').innerText();report.status=status;
 if(/FAIL|not production-complete|loading/i.test(status))fail('Portal status: '+status);
 if(await page.locator('#scheduleRows tr[data-id]').count()!==expected)fail('Board selected-week game count mismatch');
 if(await page.locator('#advantageContent tbody tr').count()!==expected)fail('Matchup Advantages coverage mismatch');
 const coverage=await page.locator('#coverageContent').innerText();
 if(!/0 blocking/.test(coverage)||/Runtime load failure|Only \d+\/32|missing canonical|Spread-sign normalization failure|vs expected/.test(coverage))fail('Coverage contains a blocking issue or wrong schedule expectation');
 const expert=await page.locator('#expertContent').innerText();
 if(!/source checks within 48h/.test(expert)||/STALE ·/.test(expert))fail('Expert source coverage is stale/missing');
 report.podcast={requiredEpisodes:podcast.requiredEpisodes,reviewedEpisodes:podcast.reviewedEpisodes,checkedRecords:currentPodcast.length};
 for(const r of currentPodcast)if(!expert.includes(r.summary)||!expert.includes(r.analyst))fail('Podcast evidence missing from Expert Intelligence: '+r.id);
 if(!coverage.includes('podcastTranscripts: PASS')||!coverage.includes(`${podcast.reviewedEpisodes}/${podcast.requiredEpisodes} selected public episodes`))fail('Live Coverage lacks selected-week podcast certification');
 await page.getByRole('button',{name:'Matchup Center',exact:true}).click();
 const options=await page.locator('#matchSel option').evaluateAll(xs=>xs.map(x=>({value:x.value,label:x.textContent})));
 if(options.length!==expected)fail('Matchup selector coverage mismatch');
 for(const option of options){
  await page.locator('#matchSel').selectOption(option.value);
  await page.locator('#nflSchemeStylePanel').waitFor({state:'visible',timeout:10000});
  const text=await page.locator('#matchContent').innerText();
  const checks=['Broader offensive / defensive metrics','Position-group matchup matrix','Scheme / Style Matchup','Weather / venue','Deep Dive thesis','Expert Intelligence'];
  const missing=checks.filter(x=>!text.includes(x));if(missing.length)fail(option.label+': missing '+missing.join(', '));
  const game=portal.games.find(g=>g.id===option.value);
  for(const r of currentPodcast.filter(r=>r.game_id===game?.canonical_game_id))if(!text.includes(r.summary))fail(option.label+': podcast record not joined '+r.id);
  if(!text.includes('Current board and model: Week '+week)||!text.includes('through Week '+(week-1)))fail(option.label+': stale statistical cutoff');
  if(!option.label.includes('FINAL')&&/Availability review pending|Timestamp missing|Weather row missing/.test(text))fail(option.label+': missing injury/weather checkpoint');
  report.matchups.push({game:option.label,missing});
 }
 await page.getByRole('button',{name:'Weekly Board',exact:true}).click();
 await page.locator('#gameSearch').fill('Houston');if(await page.locator('#scheduleRows tr[data-id]').count()!==1)fail('Board search failed');
 await page.locator('#gameSearch').fill('');
 await page.getByRole('button',{name:'Player Props',exact:true}).click();
 const propCount=await page.locator('#propContent tbody tr').count();report.propCount=propCount;
 const propLedger=await read('data/player-props-expert.json'),activeProps=[...(propLedger.recommendations||[]),...(propLedger.watchlist||propLedger.watch||[])].filter(p=>upcomingIds.has(p.gameId));
 if(propCount!==activeProps.length)fail('Live props count '+propCount+' differs from '+activeProps.length+' upcoming source opinions');
 const propText=await page.locator('#propContent').innerText();
 for(const p of activeProps)if(!propText.includes(p.player)||(p.thesis&&!propText.includes(p.thesis)))fail('Live prop evidence missing: '+p.id);
 await page.getByRole('button',{name:'Upset Lab',exact:true}).click();
 const upset=await read('data/nfl-upset-lab.json'),upsetText=await page.locator('#upsetContent').innerText();
 const qualifiers=(upset.candidates||[]).filter(x=>x.eligible&&upcomingIds.has(x.game_id));
 if(!upsetText.includes(`${qualifiers.length} verified +250 qualifiers`))fail('Live Upset Lab qualifier count mismatch');
 for(const p of [...qualifiers,...(upset.near_threshold_watch||[])])if(!upsetText.includes(p.team+' '+p.moneyline))fail('Live Upset Lab price missing: '+p.team);
 if(propCount){await page.locator('#propSearch').fill('no-such-player-qa');if(!/No recommendations match/.test(await page.locator('#propContent').innerText()))fail('Props search failed');await page.locator('#propSearch').fill('');}
 for(const width of [390,768]){
  await page.setViewportSize({width,height:844});
  const overflow=[];
  for(const t of tabs){await page.getByRole('button',{name:t.name,exact:true}).click();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))overflow.push(t.name);}
  report.mobile[width]={checkedTabs:tabs.length,pageOverflow:overflow};if(overflow.length)fail(width+'px page overflow: '+overflow.join(', '));
 }
 await page.getByRole('button',{name:'Best Bets',exact:true}).click();const before=await page.locator('#bestContent').innerText();
 await page.waitForTimeout(5500);if(before!==await page.locator('#bestContent').innerText())fail('Best Bets changed unexpectedly during 5.5s stability check');
}finally{await browser.close();}
console.log(JSON.stringify(report,null,2));
if(report.failures.length)throw Error('NFL LIVE PORTAL QA FAIL: '+report.failures.join(' | '));
console.log('NFL LIVE PORTAL QA PASS');
