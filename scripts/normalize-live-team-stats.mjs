import fs from 'node:fs/promises';
const p='data/live-team-stats.json';
const data=JSON.parse(await fs.readFile(p,'utf8'));
const num=v=>{if(v==null||v==='')return null;const n=Number(String(v).replace(/[%,$]/g,''));return Number.isFinite(n)?n:null};
const teams=Array.isArray(data.teams)?data.teams:[];
const byAbbr=new Map(teams.map(t=>[t.abbr,t]));
for(const t of teams){
  const r=t.espnStatistics||{};
  const opp=teams.find(x=>x.team===t.opponent)||null;
  const o=opp?.espnStatistics||{};
  const plays=num(r.totalOffensivePlays),yards=num(r.totalYards);
  const third=num(r.thirdDownConvPct),rz=num(r.redzoneTouchdownPct);
  const off={
    pointsPerGame:num(r.totalPointsPerGame)??num(t.pointsForPerGame),
    yardsPerGame:num(r.yardsPerGame),
    passingYardsPerGame:num(r.passingYardsPerGame),
    rushingYardsPerGame:num(r.rushingYardsPerGame),
    yardsPerPlay:plays&&yards!=null?yards/plays:null,
    yardsPerPassAttempt:num(r.yardsPerPassAttempt),
    yardsPerRush:num(r.yardsPerRushAttempt),
    thirdDownRate:third==null?null:third/100,
    redZoneTdRate:rz==null?null:rz/100
  };
  const def={
    pointsAllowedPerGame:num(t.pointsAgainstPerGame),
    yardsAllowedPerGame:num(o.yardsPerGame),
    passingYardsAllowedPerGame:num(o.passingYardsPerGame),
    rushingYardsAllowedPerGame:num(o.rushingYardsPerGame)
  };
  t.offense={...(t.offense||{}),...off};
  t.defense={...(t.defense||{}),...def};
  t.context={...(t.context||{}),games:t.games??1,opponentAdjustedRating:t.opponentAdjustedRating??null,throughWeek:t.priorWeek??null,source:'ESPN current team statistics + completed prior-week opponent box score'};
  t.units=t.units||{};
}
data.schemaVersion='2.0-matchup-display';
data.normalizedAt=new Date().toISOString();
data.method=`${data.method||''} Standard offense/defense fields normalized for Matchup Center; advanced fields remain null unless governed source data exists.`.trim();
await fs.writeFile(p,JSON.stringify(data,null,2)+'\n');
console.log(`Normalized NFL live-team-stats for ${teams.length} teams.`);
