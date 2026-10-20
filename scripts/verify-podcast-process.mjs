import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile('data/'+p,'utf8'));
const board=await read('weekly-board.json'),p=await read('expert-podcast-process-current.json'),coverage=await read('expert-source-coverage-current.json').catch(()=>null);
const ids=new Set(board.games.map(g=>g.gameId)),errors=[],episodes=p.episodes||[];
const impactClean=Object.values(p.productionImpact||{}).every(x=>Number(x)===0);
const checkedAt=p.checkedAt||p.generatedAt||null;
const sourceLimited=Number(p.season)===Number(board.season)&&Number(p.week)===Number(board.week)&&p.status==='CURRENT-SOURCE-LIMITED'&&episodes.length===0&&Date.now()-Date.parse(checkedAt||'')<48*3600000&&Number(coverage?.week)===Number(board.week)&&coverage?.status==='CURRENT_WITH_SOURCE_LIMITS'&&Number(coverage?.summary?.current||0)===Number(coverage?.summary?.required||-1)&&Number(coverage?.summary?.required||0)>0&&impactClean;
if(Number(p.season)!==Number(board.season)||Number(p.week)!==Number(board.week))errors.push('Podcast inventory is not selected-week');
if(!impactClean)errors.push('Podcast evidence has automatic production impact');
if(!sourceLimited){
 if(new Set(episodes.map(e=>e.id)).size!==episodes.length)errors.push('Duplicate episode IDs');
 if(p.status!=='COMPLETE')errors.push('Inventory remains incomplete');
 for(const e of episodes){
  if(!e.required)continue;
  if(e.transcriptStatus!=='COMPLETE'||e.reviewStatus!=='COMPLETE-NFL-MATERIAL'||!(/^[a-f0-9]{64}$/.test(e.audioSha256))||!(/^[a-f0-9]{64}$/.test(e.transcriptSha256))||!Number.isFinite(e.durationSeconds)||e.durationSeconds<=0)errors.push(e.id+': incomplete transcript/review evidence');
  if(!e.reviewedAt||Date.now()-Date.parse(e.reviewedAt)>48*3600000)errors.push(e.id+': substantive review is missing or stale');
  if(Date.parse(e.reviewedAt)>Date.now()+300000)errors.push(e.id+': future review timestamp');
  if(e.reviewedAt&&Date.parse(e.reviewedAt)<Date.parse(e.published))errors.push(e.id+': review predates publication');
  if(!e.records?.length&&!e.exclusions?.length)errors.push(e.id+': empty extraction without a review explanation');
  for(const r of e.records||[]){
   if(!ids.has(r.gameId)||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||r.end>e.durationSeconds+1||!r.analyst||r.attribution==='listener')errors.push(e.id+': invalid canonical join, speaker or transcript locator');
  }
 }
 const count=episodes.filter(e=>e.required).length;
 if(!count)errors.push('No required episodes inventoried');
 if(p.requiredEpisodes!==count||p.completedTranscripts!==count||p.reviewedEpisodes!==count)errors.push('Inventory counters do not certify every required episode');
}
console.log(JSON.stringify({status:errors.length?'FAIL':sourceLimited?'PASS-SOURCE-LIMITED':'PASS',requiredEpisodes:episodes.filter(e=>e.required).length,fullTranscripts:episodes.filter(e=>e.required&&e.transcriptStatus==='COMPLETE').length,sourceLimited,errors},null,2));
if(errors.length)process.exit(1);
