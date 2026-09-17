import fs from 'node:fs/promises';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const board=await read('data/weekly-board.json');
const season=Number(board.season||2026),week=Number(board.week||0),now=new Date().toISOString();
const games=Array.isArray(board.games)?board.games:[];
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const ABBR={
  'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB','Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC','Los Angeles Rams':'LAR','Miami Dolphins':'MIA','Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG','New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS'
};
const TEAM_NAMES=Object.keys(ABBR);

// User-supplied Ryan Paganetti Week 1 chart. We preserve only categorical quadrants;
// exact EPA values are not estimated from pixels. LEFT=better pass EPA allowed; DOWN=better run EPA allowed.
const DEFENSE={
  ARI:['weak','strong'],ATL:['strong','strong'],BAL:['strong','weak'],BUF:['weak','weak'],CAR:['very-weak','very-weak'],CHI:['weak','weak'],CIN:['strong','weak'],CLE:['very-weak','strong'],DAL:['weak','weak'],DEN:['weak','neutral'],DET:['neutral','strong'],GB:['strong','strong'],HOU:['weak','very-strong'],IND:['strong','weak'],JAX:['weak','strong'],KC:['strong','strong'],LV:['strong','weak'],LAC:['weak','neutral'],LAR:['weak','weak'],MIA:['weak','strong'],MIN:['weak','weak'],NE:['neutral','strong'],NO:['neutral','weak'],NYG:['weak','weak'],NYJ:['strong','weak'],PHI:['strong','weak'],PIT:['very-strong','strong'],SF:['strong','strong'],SEA:['neutral','very-strong'],TB:['weak','weak'],TEN:['weak','weak'],WAS:['weak','very-strong']
};

function textRows(html){return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>m[1].replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim())}
function findTeam(text){return TEAM_NAMES.find(n=>text.includes(n))||null}
function numsAfterTeam(text,team){const tail=text.slice(text.indexOf(team)+team.length);return [...tail.matchAll(/-?\d+(?:\.\d+)?/g)].map(x=>Number(x[0])).filter(Number.isFinite)}

async function sharpTendencies(){
  const url='https://www.sharpfootballanalysis.com/stats-nfl/nfl-offensive-tendencies-stats/amp/';
  const rows=[];
  try{
    const r=await fetch(url,{headers:{'user-agent':'nfl-betting-intelligence-style-layer/2.0','accept':'text/html'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const html=await r.text();
    for(const text of textRows(html)){
      const team=findTeam(text);if(!team)continue;
      const vals=numsAfterTeam(text,team);if(vals.length<5)continue;
      const [motion,playAction,airYards,shotgun,noHuddle]=vals;
      if(motion<0||motion>100)continue;
      rows.push({team,abbr:ABBR[team],motionRate:motion/100,playActionRate:playAction/100,airYardsPerAttempt:airYards,shotgunRate:shotgun/100,noHuddleRate:noHuddle/100,source:'Sharp Football Analysis'});
    }
    return{provider:'Sharp Football Analysis',url,rows:[...new Map(rows.map(x=>[x.abbr,x])).values()],error:null};
  }catch(e){return{provider:'Sharp Football Analysis',url,rows:[],error:String(e.message)}}
}

async function statRankingsMotion(){
  const url='https://statrankings.com/nfl/advanced/teams/pace-playcalling/motion-rate';const rows=[];
  try{
    const r=await fetch(url,{headers:{'user-agent':'nfl-betting-intelligence-style-layer/2.0','accept':'text/html'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const html=await r.text();
    for(const text of textRows(html)){
      const team=findTeam(text);if(!team)continue;
      const vals=[...text.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)].map(x=>Number(x[1]));const motion=vals.find(x=>x>=0&&x<=100);if(!Number.isFinite(motion))continue;
      rows.push({team,abbr:ABBR[team],motionRate:motion/100,source:'StatRankings'});
    }
    return{provider:'StatRankings',url,rows:[...new Map(rows.map(x=>[x.abbr,x])).values()],error:null};
  }catch(e){return{provider:'StatRankings',url,rows:[],error:String(e.message)}}
}

const [sharp,fallback]=await Promise.all([sharpTendencies(),statRankingsMotion()]);
const offenseByAbbr=new Map(fallback.rows.map(x=>[x.abbr,x]));
for(const x of sharp.rows)offenseByAbbr.set(x.abbr,{...(offenseByAbbr.get(x.abbr)||{}),...x});
const allTeams=[...new Set(games.flatMap(g=>[g.away,g.home]).filter(Boolean))];
const teamRows=allTeams.map(team=>{
  const abbr=ABBR[team]||games.flatMap(g=>[{n:g.away,a:g.awayAbbr},{n:g.home,a:g.homeAbbr}]).find(x=>x.n===team)?.a||null;
  const o=offenseByAbbr.get(abbr)||{},d=DEFENSE[abbr]||[null,null],rate=Number.isFinite(o.motionRate)?o.motionRate:null;
  return {team,abbr,offense:{motionRate:rate,motionUsage:rate==null?'SOURCE_PENDING':rate>=.65?'HIGH':rate>=.55?'AVERAGE':'LOW',playActionRate:o.playActionRate??null,airYardsPerAttempt:o.airYardsPerAttempt??null,shotgunRate:o.shotgunRate??null,noHuddleRate:o.noHuddleRate??null,source:o.source||null},defenseVsMotion:{passProfile:d[0],runProfile:d[1],numericEpaAvailable:false},sample:{throughWeek:Math.max(1,week-1),warning:'Early-season schematic split; research-only until larger sample and holdout validation.'}};
});
const byAbbr=new Map(teamRows.map(x=>[x.abbr,x]));
const severity=x=>({'very-weak':2,'weak':1,'neutral':0,'strong':-1,'very-strong':-2}[x]??0);
function interaction(offense,defense){
  const rate=offense?.offense?.motionRate,usage=offense?.offense?.motionUsage||'SOURCE_PENDING',pass=defense?.defenseVsMotion?.passProfile,run=defense?.defenseVsMotion?.runProfile,flags=[];
  if(rate==null)flags.push('MOTION-RATE SOURCE PENDING');
  if(usage==='HIGH'&&severity(pass)>=1)flags.push('PASS-MOTION ADVANTAGE');
  if(usage==='HIGH'&&severity(run)>=1)flags.push('RUN-MOTION ADVANTAGE');
  if(usage==='HIGH'&&severity(pass)<=-1&&severity(run)<=-1)flags.push('HIGH-MOTION OFFENSE vs MOTION-RESISTANT DEFENSE');
  if(usage==='HIGH'&&(severity(pass)>=1||severity(run)>=1))flags.push('HIGH-MOTION OFFENSE vs MOTION-VULNERABLE DEFENSE');
  if(!flags.some(x=>/ADVANTAGE|VULNERABLE|RESISTANT/.test(x))&&rate!=null)flags.push('STYLE NEUTRAL / MIXED');
  flags.push('SMALL-SAMPLE WARNING');
  return{offense:offense?.abbr,defense:defense?.abbr,motionRate:rate??null,motionUsage:usage,playActionRate:offense?.offense?.playActionRate??null,shotgunRate:offense?.offense?.shotgunRate??null,noHuddleRate:offense?.offense?.noHuddleRate??null,defensePassVsMotion:pass,defenseRunVsMotion:run,flags,modelPointImpact:0};
}
const matchupRows=games.map(g=>({gameId:g.gameId,matchup:`${g.away} at ${g.home}`,awayOffenseVsHomeDefense:interaction(byAbbr.get(g.awayAbbr),byAbbr.get(g.homeAbbr)),homeOffenseVsAwayDefense:interaction(byAbbr.get(g.homeAbbr),byAbbr.get(g.awayAbbr))}));
const parsed=[...offenseByAbbr.values()].filter(x=>Number.isFinite(x.motionRate)).length;
const output={season,week,updatedAt:now,status:parsed>=28?'CURRENT-MOTION-RATE':'PARTIAL-MOTION-RATE',governance:'Research/display and Deep Dive confidence only. 0.0 automatic production fair-line points until incremental holdout validation demonstrates value beyond existing priors/current team stats/QB/market inputs.',sources:{offenseTendencies:{primary:{provider:sharp.provider,url:sharp.url,retrievedAt:now,parsedTeams:sharp.rows.length,error:sharp.error},fallback:{provider:fallback.provider,url:fallback.url,retrievedAt:now,parsedTeams:fallback.rows.length,error:fallback.error}},defenseMotion:{provider:'Ryan Paganetti Week 1 defensive EPA allowed vs motion-at-snap chart supplied by user',sourceType:'USER_SUPPLIED_VISUAL',treatment:'Categorical quadrant classification only; exact EPA numbers are not transcribed from image pixels.',throughWeek:1}},coverage:{selectedWeekTeams:teamRows.length,motionRateTeams:teamRows.filter(x=>Number.isFinite(x.offense.motionRate)).length,playActionTeams:teamRows.filter(x=>Number.isFinite(x.offense.playActionRate)).length},teams:teamRows,games:matchupRows};
await write('data/nfl-style-matchups.json',output);
console.log(`NFL style layer: week=${week} teams=${teamRows.length} motion=${output.coverage.motionRateTeams} playAction=${output.coverage.playActionTeams} matchups=${matchupRows.length}`);
