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
const NAME_BY_KEY=new Map(Object.keys(ABBR).map(n=>[norm(n),n]));

// User-supplied Ryan Paganetti Week 1 chart. We intentionally preserve only categorical
// quadrants from the visual; exact EPA values are NOT transcribed from pixels.
// pass: LEFT on chart = lower/better pass EPA allowed vs motion at snap.
// run: DOWN on chart = lower/better run EPA allowed vs motion at snap.
const DEFENSE={
  ARI:['weak','strong'],ATL:['strong','strong'],BAL:['strong','weak'],BUF:['weak','weak'],CAR:['very-weak','very-weak'],CHI:['weak','weak'],CIN:['strong','weak'],CLE:['very-weak','strong'],DAL:['weak','weak'],DEN:['weak','neutral'],DET:['neutral','strong'],GB:['strong','strong'],HOU:['weak','very-strong'],IND:['strong','weak'],JAX:['weak','strong'],KC:['strong','strong'],LV:['strong','weak'],LAC:['weak','neutral'],LAR:['weak','weak'],MIA:['weak','strong'],MIN:['weak','weak'],NE:['neutral','strong'],NO:['neutral','weak'],NYG:['weak','weak'],NYJ:['strong','weak'],PHI:['strong','weak'],PIT:['very-strong','strong'],SF:['strong','strong'],SEA:['neutral','very-strong'],TB:['weak','weak'],TEN:['weak','weak'],WAS:['weak','very-strong']
};

async function currentMotionRates(){
  const url='https://statrankings.com/nfl/advanced/teams/pace-playcalling/motion-rate';
  const out=[];
  try{
    const r=await fetch(url,{headers:{'user-agent':'nfl-betting-intelligence-style-layer/1.0','accept':'text/html'}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const html=await r.text();
    // SSR table parser. Team names may be rendered as image alt text or visible anchor text.
    for(const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
      const row=m[1];
      const alt=[...row.matchAll(/<img[^>]+alt=["']([^"']+)["']/gi)].map(x=>x[1]).find(x=>NAME_BY_KEY.has(norm(x)));
      const text=row.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
      const visible=[...NAME_BY_KEY.values()].find(n=>text.includes(n));
      const team=alt||visible;
      if(!team)continue;
      const pct=[...text.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)].map(x=>Number(x[1])).find(x=>x>=0&&x<=100);
      if(!Number.isFinite(pct))continue;
      out.push({team,abbr:ABBR[team],motionRate:pct/100});
    }
    return {url,rows:[...new Map(out.map(x=>[x.abbr,x])).values()],error:null};
  }catch(e){return {url,rows:[],error:String(e.message)}}
}

const motion=await currentMotionRates();
const motionByAbbr=new Map(motion.rows.map(x=>[x.abbr,x]));
const allTeams=[...new Set(games.flatMap(g=>[g.away,g.home]).filter(Boolean))];
const teamRows=allTeams.map(team=>{
  const abbr=ABBR[team]||games.flatMap(g=>[{n:g.away,a:g.awayAbbr},{n:g.home,a:g.homeAbbr}]).find(x=>x.n===team)?.a||null;
  const m=motionByAbbr.get(abbr),d=DEFENSE[abbr]||[null,null];
  return {team,abbr,offense:{motionRate:m?.motionRate??null,motionUsage:m?((m.motionRate>=.65)?'HIGH':m.motionRate>=.55?'AVERAGE':'LOW'):'SOURCE_PENDING'},defenseVsMotion:{passProfile:d[0],runProfile:d[1],numericEpaAvailable:false},sample:{throughWeek:Math.max(1,week-1),warning:'Early-season schematic split; research-only until larger sample and holdout validation.'}};
});
const byAbbr=new Map(teamRows.map(x=>[x.abbr,x]));
const severity=x=>({'very-weak':2,'weak':1,'neutral':0,'strong':-1,'very-strong':-2}[x]??0);
function interaction(offense,defense){
  const rate=offense?.offense?.motionRate,usage=offense?.offense?.motionUsage||'SOURCE_PENDING';
  const pass=defense?.defenseVsMotion?.passProfile,run=defense?.defenseVsMotion?.runProfile;
  const flags=[];
  if(rate==null)flags.push('MOTION-RATE SOURCE PENDING');
  if(usage==='HIGH'&&severity(pass)>=1)flags.push('PASS-MOTION ADVANTAGE');
  if(usage==='HIGH'&&severity(run)>=1)flags.push('RUN-MOTION ADVANTAGE');
  if(usage==='HIGH'&&severity(pass)<=-1&&severity(run)<=-1)flags.push('HIGH-MOTION OFFENSE vs MOTION-RESISTANT DEFENSE');
  if(usage==='HIGH'&&(severity(pass)>=1||severity(run)>=1))flags.push('HIGH-MOTION OFFENSE vs MOTION-VULNERABLE DEFENSE');
  if(!flags.some(x=>/ADVANTAGE|VULNERABLE|RESISTANT/.test(x))&&rate!=null)flags.push('STYLE NEUTRAL / MIXED');
  flags.push('SMALL-SAMPLE WARNING');
  return {offense:offense?.abbr,defense:defense?.abbr,motionRate:rate??null,motionUsage:usage,defensePassVsMotion:pass,defenseRunVsMotion:run,flags,modelPointImpact:0};
}
const matchupRows=games.map(g=>{
  const away=byAbbr.get(g.awayAbbr),home=byAbbr.get(g.homeAbbr);
  return {gameId:g.gameId,matchup:`${g.away} at ${g.home}`,awayOffenseVsHomeDefense:interaction(away,home),homeOffenseVsAwayDefense:interaction(home,away)};
});
const output={season,week,updatedAt:now,status:motion.rows.length>=20?'CURRENT-MOTION-RATE':'PARTIAL-MOTION-RATE',governance:'Research/display and Deep Dive confidence only. 0.0 automatic production fair-line points until incremental holdout validation demonstrates value beyond existing priors/current team stats/QB/market inputs.',sources:{offenseMotion:{provider:'StatRankings',url:motion.url,retrievedAt:now,parsedTeams:motion.rows.length,error:motion.error},defenseMotion:{provider:'Ryan Paganetti Week 1 defensive EPA allowed vs motion-at-snap chart supplied by user',sourceType:'USER_SUPPLIED_VISUAL',treatment:'Categorical quadrant classification only; exact EPA numbers are not transcribed from image pixels.',throughWeek:1}},teams:teamRows,games:matchupRows};
await write('data/nfl-style-matchups.json',output);
console.log(`NFL style layer: week=${week} teams=${teamRows.length} currentMotionRates=${motion.rows.length} matchups=${matchupRows.length}`);
