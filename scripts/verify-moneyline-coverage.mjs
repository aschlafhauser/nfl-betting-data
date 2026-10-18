import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile('data/'+p,'utf8'));
const board=await read('weekly-board.json'),portal=await read('nfl-weekly-board.json'),upset=await read('nfl-upset-lab.json');
const failures=[],qualified=[],near=[],now=Date.now();
for(const g of board.games||[]){
 if(g.eventState==='final')continue;
 const p=g.moneyline,valid=p&&Number.isFinite(p.away)&&Number.isFinite(p.home)&&Math.abs(p.away)>=100&&Math.abs(p.home)>=100&&now-Date.parse(p.observedAt||'')<6*3600000;
 if(!valid){if(g.currentMoneyline)failures.push(g.gameId+': displayed ML lacks fresh complete numeric provenance');continue;}
 const legacy=(portal.games||[]).find(x=>x.canonical_game_id===g.gameId);
 if(legacy?.market?.moneyline?.away!==p.away||legacy?.market?.moneyline?.home!==p.home)failures.push(g.gameId+': canonical/portal ML mismatch');
 for(const [side,price] of [['away',p.away],['home',p.home]]){
  if(price<200)continue;
  const team=side==='away'?g.awayAbbr:g.homeAbbr;
  const rows=price>=250?upset.candidates:upset.near_threshold_watch;
  const row=(rows||[]).find(x=>x.game_id===g.gameId&&x.team===team);
  if(!row||row.moneyline!==price||row.eligible!==(price>=250))failures.push(g.gameId+': observed '+price+' qualifier/watch missing or incorrectly eligible');
  (price>=250?qualified:near).push({gameId:g.gameId,team,price});
 }
}
for(const x of upset.candidates||[])if(x.eligible&&(!Number.isFinite(x.moneyline)||x.moneyline<250))failures.push(x.game_id+': false +250 eligibility');
console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',qualified,near,failures},null,2));
if(failures.length)process.exit(1);
