import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const board=await read('data/weekly-board.json');
const season=Number(board.season||2026),week=Number(process.env.NFL_WEEK||board.week);
const resultPath=`data/results-${season}.json`;
const results=await read(resultPath);
const registry=await read('data/team-identity-registry.json');
const norm=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const aliases=new Map(registry.teams.flatMap(t=>[t.abbr,t.canonical,...(t.aliases||[])].map(a=>[norm(a),t.abbr])));
const abbr=x=>aliases.get(norm(x))||null;
const canonicalKey=(w,a,h)=>`${season}-W${w}-${a}-${h}`;
const boardKeys=new Map(board.games.map(g=>[canonicalKey(week,abbr(g.awayAbbr),abbr(g.homeAbbr)),g.gameId]));
const getWeek=async w=>{
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${w}&limit=100`;
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'nfl-governed-results/1.0'},signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error(`ESPN Week ${w} results fetch failed: HTTP ${r.status}`);
  const j=await r.json();
  if(Number(j.week?.number)!==w||!j.events?.length)throw Error(`ESPN returned the wrong or empty slate for Week ${w}`);
  return {week:w,url,events:j.events};
};
await fs.mkdir('data/results-clv',{recursive:true});
const snapshots=(await fs.readdir('data/final-snapshots').catch(()=>[])).filter(n=>n.endsWith('.json'));
const bySnapshot=new Map();
for(const n of snapshots){
  const file=`data/final-snapshots/${n}`,x=await read(file);
  if(Number(x.season)!==season||!x.immutable||x.finalSnapshotStatus!=='FROZEN'||!x.gameId)continue;
  const [,,a,h]=x.gameId.split('-');
  if(!abbr(a)||!abbr(h))continue;
  const id=canonicalKey(x.week,abbr(a),abbr(h));
  if(!bySnapshot.has(id))bySnapshot.set(id,[]);
  bySnapshot.get(id).push({file,x});
}
const score=c=>c?.score!=null&&/^\d+$/.test(String(c.score))?Number(c.score):null;
const marketMargin=(spread,a,h)=>{
  if(/^\s*(PK|PICK(?:'EM)?)\s*$/i.test(spread||''))return 0;
  const m=String(spread||'').match(/^(.+?)\s+-([\d.]+)(?:\s|$)/);
  if(!m||!Number.isFinite(Number(m[2])))return null;
  const fav=abbr(m[1]);return fav===h?Number(m[2]):fav===a?-Number(m[2]):null;
};
const captureAt=new Date().toISOString();
const stored=new Map((results.games||[]).map(g=>[g.gameId,g]));
const storedEspnIds=new Set([...stored.values()].map(g=>g.espnEventId).filter(Boolean));
const startedBefore=Date.now();
const isHistoricalRepair=process.argv.includes('--backfill-results')||!stored.size;
const weeks=isHistoricalRepair?Array.from({length:week},(_,i)=>i+1):[week];
let added=0,artifacts=0;
for(let i=0;i<weeks.length;i+=3){
 const feeds=await Promise.all(weeks.slice(i,i+3).map(getWeek));
 for(const feed of feeds)for(const ev of feed.events){
  const c=ev.competitions?.[0];
  if(!c?.status?.type?.completed||c.status.type.state!=='post'||!/^STATUS_FINAL/.test(c.status.type.name||''))continue;
  const away=c.competitors?.find(x=>x.homeAway==='away'),home=c.competitors?.find(x=>x.homeAway==='home');
  const a=abbr(away?.team?.abbreviation),h=abbr(home?.team?.abbreviation),awayScore=score(away),homeScore=score(home);
  const kickoff=Date.parse(ev.date||c.date);
  if(!a||!h||awayScore===null||homeScore===null||!Number.isFinite(kickoff)||kickoff>=startedBefore)throw Error(`Unverifiable final ESPN event ${ev.id}`);
  const matchKey=canonicalKey(feed.week,a,h);
  if(feed.week===week&&!boardKeys.has(matchKey))throw Error(`Final has no canonical Week ${week} board match: ${matchKey}`);
  const gameId=feed.week===week?boardKeys.get(matchKey):matchKey;
  if(stored.has(gameId)||storedEspnIds.has(String(ev.id)))continue;
  const matchup=`${away.team.displayName} at ${home.team.displayName}`;
  const actualHomeMargin=homeScore-awayScore;
  const snap=(bySnapshot.get(matchKey)||[]).filter(({x})=>{
    const t=Date.parse(x.recordedAt||x.timestamp),k=Date.parse(x.kickoff);
    return Number.isFinite(t)&&t<kickoff&&kickoff-t<=90*60000&&k===kickoff;
  }).sort((a,b)=>Date.parse(b.x.recordedAt||b.x.timestamp)-Date.parse(a.x.recordedAt||a.x.timestamp))[0];
  const p=snap?.x,market=p?.market?.spread??p?.market?.representativeCurrentSpread??null;
  const structural=p?.production?.structuralSpread??null,production=p?.production?.spread??p?.productionFair??null;
  const err=spread=>{const margin=marketMargin(spread,a,h);return margin===null?null:Math.abs(actualHomeMargin-margin)};
  const row={gameId,week:feed.week,matchup,kickoff:new Date(kickoff).toISOString(),status:'FINAL',awayScore,homeScore,actualHomeMargin,
    winner:awayScore===homeScore?'TIE':awayScore>homeScore?away.team.displayName:home.team.displayName,
    espnEventId:String(ev.id),source:'ESPN NFL scoreboard',sourceUrl:feed.url,capturedAt:captureAt,
    finalSnapshotId:snap?.file??null,snapshotStatus:snap?'VERIFIED-IMMUTABLE-PRE-KICKOFF':'MISSING-PRESERVED-AUDIT-DEBT',
    marketAtDecision:market,structuralAtDecision:structural,productionAtDecision:production,
    closingSpread:null,closingTotal:null,structuralError:err(structural),productionError:err(production),marketError:err(market),
    officialBet:null,betPrice:null,closingLineValue:null,atsResult:null,units:null,blockedEdgeOutcome:null};
  const artifact={schemaVersion:'nfl-result-clv-v1',sport:'NFL',season,week:feed.week,gameId,matchup,capturedAt:captureAt,
    result:{awayScore,homeScore,winner:row.winner,status:'FINAL',source:row.source,sourceUrl:row.sourceUrl},
    closingSnapshot:snap?{status:'AVAILABLE-PRE-KICKOFF-REFERENCE',file:snap.file,spread:market,
      total:p.market?.total??p.market?.representativeCurrentTotal??null,moneyline:p.market?.moneyline??null,
      frozenAt:p.timestamp||p.recordedAt||null}:{status:'MISSING-PRESERVED-AUDIT-DEBT',file:null},
    officialPortfolio:{count:Number.isInteger(p?.officialPortfolio?.count)?p.officialPortfolio.count:null,
      clvStatus:'NOT-CALCULATED',note:'Requires a separately reconciled official wager and verified sportsbook close. A pre-kickoff reference is not necessarily the close.'},
    governance:'Historical final scores may be imported. Missing pre-kickoff state is never reconstructed.'};
  if(feed.week===week){
   const file=`data/results-clv/${season}-w${week}-${gameId.toLowerCase()}.json`;
   try{await fs.writeFile(file,JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});artifacts++}catch(e){if(e.code!=='EEXIST')throw e}
  }
  stored.set(gameId,row);storedEspnIds.add(String(ev.id));added++;
 }
}
if(added){
 results.updatedAt=captureAt;
 results.schema.rule='Verified final scores may be imported after completion. Immutable, schedule-matched pre-kickoff snapshots are the only source of model-at-decision values; an exact sportsbook close and official wager must be independently reconciled before CLV is calculated.';
 results.games=[...stored.values()].sort((a,b)=>a.week-b.week||String(a.kickoff).localeCompare(String(b.kickoff))||a.gameId.localeCompare(b.gameId));
 const temp=resultPath+'.tmp';
 await fs.writeFile(temp,JSON.stringify(results,null,2)+'\n');
 await fs.rename(temp,resultPath);
}
console.log(`NFL final results: ${added} added, ${stored.size} in season registry; ${artifacts} new selected-week CLV artifacts.`);
