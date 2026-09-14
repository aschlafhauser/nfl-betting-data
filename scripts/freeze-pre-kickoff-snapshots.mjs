import fs from 'node:fs/promises';
import path from 'node:path';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const board=await read('data/weekly-board.json');
const injuries=await read('data/injuries.json').catch(()=>({games:[]}));
const weather=await read('data/nfl-weather-current.json').catch(()=>({games:[]}));
const season=Number(board.season||2026),week=Number(process.env.NFL_WEEK||board.week),now=new Date(process.env.NFL_AS_OF||Date.now());
const lookahead=Number(process.env.NFL_SNAPSHOT_LOOKAHEAD_MINUTES||90);
if(!Number.isFinite(week)||Number.isNaN(now.getTime()))throw new Error('Valid NFL selected week and snapshot time are required');
await fs.mkdir('data/final-snapshots',{recursive:true});
const injuryByMatchup=new Map((injuries.games||[]).map(x=>[x.matchup,x]));
const weatherByGame=new Map((weather.games||[]).map(x=>[x.canonical_game_id,x]));
const safe=s=>String(s||'game').replace(/[^a-zA-Z0-9._-]+/g,'-').toLowerCase();
let frozen=0,existing=0,notDue=0,blocked=0;
for(const g of board.games||[]){
  const kickoff=Date.parse(g.dateTime||''),id=g.gameId;if(!id||!Number.isFinite(kickoff)){notDue++;continue}
  const delta=(kickoff-now.getTime())/60000;if(delta<=0||delta>lookahead){notDue++;continue}
  const matchup=`${g.away} at ${g.home}`,inj=injuryByMatchup.get(matchup),inactiveVerified=/inactive checkpoint (complete|verified)|official inactives (reviewed|verified)/i.test(String(inj?.status||''));
  if(!inactiveVerified){blocked++;console.log(`Snapshot blocked for ${id}: official inactive checkpoint not yet verified.`);continue}
  const file=path.join('data/final-snapshots',`${season}-w${week}-${safe(id)}.json`);try{await fs.access(file);existing++;continue}catch{}
  const wx=weatherByGame.get(id)||null;
  const snapshot={season,week,gameId:id,matchup,kickoff:new Date(kickoff).toISOString(),timestamp:now.toISOString(),recordedAt:now.toISOString(),minutesBeforeKickoff:Number(delta.toFixed(1)),immutable:true,finalSnapshotStatus:'FROZEN',market:{spread:g.currentSpread??null,total:g.currentTotal??null,moneyline:g.currentMoneyline??null,source:g.marketSource??null,observedAt:g.marketObservedAt??board.updatedAt??null},production:{spread:g.productionSpread??null,structuralSpread:g.validatedStructuralSpread??null,structuralEdge:g.structuralEdge??null,lean:g.structuralLean??null,classification:g.classification??null,stage:g.stage??null},availability:{inactiveCheckpointStatus:inj?.status??null,flags:inj?.flags??[],weather:wx?{environment:wx.environment??null,status:wx.status??null,summary:wx.summary??null,observedAt:wx.observed_at??null,totalAdjustmentPoints:wx.total_adjustment_points??0}:null},officialPortfolio:board.officialPortfolio??null,governance:{officialInactiveListVerified:true,immutable:true,backfillProhibited:true,note:'Prospective final pre-kickoff state. Never overwrite or reconstruct after kickoff.'}};
  try{await fs.writeFile(file,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});frozen++;console.log(`Frozen ${id} ${snapshot.minutesBeforeKickoff} minutes before kickoff.`)}catch(e){if(e?.code==='EEXIST')existing++;else throw e}
}
console.log(`NFL pre-kickoff freeze: ${frozen} new, ${existing} existing, ${blocked} blocked on official inactives, ${notDue} not due.`);
