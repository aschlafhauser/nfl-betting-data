import fs from 'node:fs/promises';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const adv=await read('data/live-team-advanced.json');
const board=await read('data/nfl-weekly-board.json');
const teams=adv.teams||[],by=Object.fromEntries(teams.map(t=>[t.abbr,t]));
const meanSd=vals=>{vals=vals.filter(Number.isFinite);const m=vals.reduce((a,b)=>a+b,0)/vals.length;const sd=Math.sqrt(vals.reduce((a,b)=>a+(b-m)**2,0)/vals.length)||1;return{m,sd}};
const z=(x,s)=>(Number(x)-s.m)/s.sd,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const defs=[
 {key:'overallEpa',label:'Overall EPA',w:.18,of:t=>t.offense.epaPerPlay,df:t=>t.defense.epaAllowedPerPlay},
 {key:'successRate',label:'Success rate',w:.16,of:t=>t.offense.successRate,df:t=>t.defense.successRateAllowed},
 {key:'earlyDownEpa',label:'Early-down EPA',w:.14,of:t=>t.offense.earlyDownEpa,df:t=>t.defense.earlyDownEpaAllowed},
 {key:'dropbackEpa',label:'Dropback EPA',w:.18,of:t=>t.offense.dropbackEpa,df:t=>t.defense.dropbackEpaAllowed},
 {key:'rushEpa',label:'Rush EPA',w:.12,of:t=>t.offense.rushEpa,df:t=>t.defense.rushEpaAllowed},
 {key:'explosiveRate',label:'Explosive rate',w:.10,of:t=>t.offense.explosivePlayRate,df:t=>t.defense.explosivePlayRateAllowed}
];
const norm={};for(const d of defs)norm[d.key]={o:meanSd(teams.map(d.of)),d:meanSd(teams.map(d.df))};
const pa=meanSd(teams.map(t=>t.offense.pressureRateAllowed)),pr=meanSd(teams.map(t=>t.defense.pressureRate));
function side(T,O){
 const drivers=defs.map(d=>({key:d.key,label:d.label,weight:d.w,z:+(z(d.of(T),norm[d.key].o)+z(d.df(O),norm[d.key].d)).toFixed(3)}));
 drivers.push({key:'passProtection',label:'Pass protection vs pressure',weight:.12,z:+((-z(T.offense.pressureRateAllowed,pa)-z(O.defense.pressureRate,pr))).toFixed(3)});
 const raw=drivers.reduce((s,x)=>s+x.weight*x.z,0);
 return{raw:+raw.toFixed(3),score:+clamp(50+12*raw,0,100).toFixed(1),drivers:drivers.sort((a,b)=>Math.abs(b.z)-Math.abs(a.z)).slice(0,4)};
}
const games=[];
for(const g of board.games||[]){
 const aa=g.awayAbbr||g.away_abbr||Object.keys(by).find(k=>by[k].team===g.away);
 const ha=g.homeAbbr||g.home_abbr||Object.keys(by).find(k=>by[k].team===g.home);
 const AT=by[aa],HT=by[ha];if(!AT||!HT)continue;
 const away=side(AT,HT),home=side(HT,AT),diff=+(home.score-away.score).toFixed(1);
 const fav=Math.abs(diff)<3?'NEUTRAL':diff>0?ha:aa,gap=Math.abs(diff),structuralLean=g.model?.edge_side||null;
 const alignment=fav==='NEUTRAL'||!structuralLean?'NEUTRAL':fav===structuralLean?'CONFIRMED':'CONFLICT';
 games.push({gameId:g.canonical_game_id||g.canonicalGameId||g.id,portalGameId:g.id,away:g.away,awayAbbr:aa,home:g.home,homeAbbr:ha,marketSpread:g.market?.spread_display||g.market?.spread||null,structuralFair:g.model?.structural_fair||null,productionFair:g.model?.fair_spread_display||g.model?.fair_spread||null,structuralLean,matchupFavoredSide:fav,advantageGap:+gap.toFixed(1),alignment,awayScore:away.score,homeScore:home.score,awayRaw:away.raw,homeRaw:home.raw,awayDrivers:away.drivers,homeDrivers:home.drivers});
}
games.sort((a,b)=>b.advantageGap-a.advantageGap);
await write('data/advanced-matchup-advantages-current.json',{season:board.season||2026,week:board.week,generatedAt:new Date().toISOString(),throughWeek:adv.throughWeek||2,methodologyVersion:'1.0-advanced-matchup-diagnostic',productionApproved:false,productionPointImpact:0,scoring:{neutral:50,interpretation:'50 = neutral matchup environment; higher scores indicate a more favorable offense-vs-opposing-defense statistical matchup. Advantage Gap is the absolute score difference between teams.',weights:{overallEpa:.18,successRate:.16,earlyDownEpa:.14,dropbackEpa:.18,rushEpa:.12,explosiveRate:.10,passProtectionVsPressure:.12},governance:'Diagnostic ranking and market-comparison layer only. No automatic fair-spread points until holdout validation clears.'},games});
console.log('advanced matchup advantages',games.length);
