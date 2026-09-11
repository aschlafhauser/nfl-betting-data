import fs from 'node:fs/promises';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const canonicalPath='data/weekly-board.json';
const legacyPath='data/nfl-weekly-board.json';
const canonical=await read(canonicalPath);
const legacy=await read(legacyPath);
const season=Number(canonical.season||2026),week=Number(canonical.week||1);
const now=new Date().toISOString();
const url=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=100`;
const ml=v=>{const n=Number(v);return Number.isFinite(n)?`${n>0?'+':''}${n}`:null};
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clean=s=>String(s||'').trim();
const normAbbr=v=>{
  const a=clean(v).toUpperCase();
  return ({WSH:'WAS',WAS:'WAS',JAX:'JAC',JAC:'JAC'})[a]||a;
};

function teamLabel(c){return c?.team?.displayName||c?.team?.shortDisplayName||c?.team?.location||c?.team?.name||null}
function oddsRow(ev){
  const c=ev?.competitions?.[0]||{},cs=c.competitors||[];
  const a=cs.find(x=>x.homeAway==='away'),h=cs.find(x=>x.homeAway==='home');
  if(!a||!h)return null;
  const o=Array.isArray(c.odds)?c.odds[0]:null;
  const awayAbbr=normAbbr(a?.team?.abbreviation),homeAbbr=normAbbr(h?.team?.abbreviation);
  const details=clean(o?.details);
  let favoriteAbbr=null,line=null;
  const m=details.match(/^([^\s]+)\s+(-?\d+(?:\.\d+)?)/);
  if(m){favoriteAbbr=normAbbr(m[1]);line=Number(m[2]);}
  const awayName=teamLabel(a),homeName=teamLabel(h);
  let spreadDisplay=details||null,homeBookSpread=null,homeMargin=null;
  if(Number.isFinite(line)&&favoriteAbbr){
    const pts=Math.abs(line);
    if(favoriteAbbr===homeAbbr){spreadDisplay=`${homeName} -${pts}`;homeBookSpread=-pts;homeMargin=pts;}
    else if(favoriteAbbr===awayAbbr){spreadDisplay=`${awayName} -${pts}`;homeBookSpread=pts;homeMargin=-pts;}
  }
  const total=num(o?.overUnder),awayML=ml(o?.awayTeamOdds?.moneyLine),homeML=ml(o?.homeTeamOdds?.moneyLine);
  const completed=String(ev?.status?.type?.state||'').toLowerCase()==='post'||Boolean(ev?.status?.type?.completed);
  return {eventId:String(ev.id),awayAbbr,homeAbbr,awayName,homeName,kickoff:ev.date||c.date||null,completed,spreadDisplay,total:total&&total>0?total:null,awayML,homeML,homeBookSpread,homeMargin,source:o?.provider?.name?`ESPN ${o.provider.name}`:(o?'ESPN odds feed':null),hasOdds:!!o};
}

const r=await fetch(url,{headers:{accept:'application/json','user-agent':'nfl-governed-runtime-refresh/1.0'}});
if(!r.ok)throw new Error(`ESPN NFL scoreboard fetch failed: HTTP ${r.status}`);
const payload=await r.json();
const rows=(payload.events||[]).map(oddsRow).filter(Boolean);
const byAbbr=new Map(rows.map(x=>[`${normAbbr(x.awayAbbr)}__${normAbbr(x.homeAbbr)}`,x]));
const canonicalGames=Array.isArray(canonical.games)?canonical.games:[];
if(rows.length!==canonicalGames.length)throw new Error(`ESPN selected-week slate mismatch: ${rows.length}/${canonicalGames.length}`);

function parseTeamLine(display,homeAbbr,awayAbbr,homeName,awayName){
  const s=String(display||'');const m=s.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)$/);if(!m)return null;
  const team=m[1].trim(),line=Number(m[2]);if(!Number.isFinite(line))return null;
  const isHome=team===homeName||normAbbr(team)===normAbbr(homeAbbr);const isAway=team===awayName||normAbbr(team)===normAbbr(awayAbbr);
  if(!isHome&&!isAway)return null;return isHome?-line:line;
}
function displayFromHomeMargin(home,away,hm){
  if(!Number.isFinite(hm)||Math.abs(hm)<0.05)return 'Pick';
  const fav=hm>0?home:away,pts=Math.abs(hm);return `${fav} -${Number(pts.toFixed(1))}`;
}

let liveOdds=0;
const updatedCanonical=canonicalGames.map(g=>{
  const row=byAbbr.get(`${normAbbr(g.awayAbbr)}__${normAbbr(g.homeAbbr)}`);
  if(!row)throw new Error(`No ESPN row for ${g.gameId} (${g.awayAbbr}-${g.homeAbbr}) after abbreviation normalization`);
  const hasCurrent=row.hasOdds&&row.spreadDisplay&&row.total!=null;
  if(hasCurrent)liveOdds++;
  const currentSpread=hasCurrent?row.spreadDisplay:g.currentSpread;
  const currentTotal=hasCurrent?row.total:g.currentTotal;
  const currentMoneyline=(row.awayML||row.homeML)?`${g.awayAbbr} ${row.awayML||'—'} / ${g.homeAbbr} ${row.homeML||'—'}`:g.currentMoneyline;
  const marketHM=hasCurrent?row.homeMargin:parseTeamLine(g.currentSpread,g.homeAbbr,g.awayAbbr,g.home,g.away);
  const structuralHM=parseTeamLine(g.validatedStructuralSpread,g.homeAbbr,g.awayAbbr,g.home,g.away);
  let productionSpread=g.productionSpread,structuralEdge=g.structuralEdge,structuralLean=g.structuralLean;
  if(Number.isFinite(marketHM)&&Number.isFinite(structuralHM)){
    const prodHM=0.8*marketHM+0.2*structuralHM;
    productionSpread=displayFromHomeMargin(g.home,g.away,prodHM);
    structuralEdge=Number(Math.abs(structuralHM-marketHM).toFixed(1));
    structuralLean=structuralHM>marketHM?g.homeAbbr:structuralHM<marketHM?g.awayAbbr:'NONE';
  }
  return {...g,dateTime:row.kickoff||g.dateTime,currentSpread,currentTotal,currentMoneyline,marketSource:hasCurrent?(row.source||'ESPN odds feed'):g.marketSource,marketObservedAt:hasCurrent?now:(g.marketObservedAt||null),eventState:row.completed?'final':'scheduled',productionSpread,structuralEdge,structuralLean};
});

const canonByTeams=new Map(updatedCanonical.map(g=>[`${String(g.away).toLowerCase()}__${String(g.home).toLowerCase()}`,g]));
const updatedLegacy=(legacy.games||[]).map(g=>{
  const cg=canonByTeams.get(`${String(g.away).toLowerCase()}__${String(g.home).toLowerCase()}`);
  if(!cg)return g;
  const row=byAbbr.get(`${normAbbr(cg.awayAbbr)}__${normAbbr(cg.homeAbbr)}`);
  const hasCurrent=row?.hasOdds&&row.spreadDisplay&&row.total!=null;
  const market=hasCurrent?{
    ...(g.market||{}),spread_display:row.spreadDisplay,home_team_sportsbook_spread:row.homeBookSpread,home_margin:row.homeMargin,total:row.total,
    moneyline:{away:row.awayML?Number(row.awayML):null,home:row.homeML?Number(row.homeML):null},source:row.source||'ESPN odds feed',timestamp:now,status:'current governed ESPN snapshot; exact sportsbook/juice required before execution'
  }:{...(g.market||{}),status:row?.completed?'historical closing snapshot; completed game exempt from live-market freshness':'PRICE-RECHECK-REQUIRED'};

  // Market refresh and executable edge must move together. Keep the existing governed
  // independent fair, but always recompute edge in the same home-margin convention.
  // This prevents stale legacy edges from surviving after ESPN reprices a game.
  const fairHM=num(g.model?.fair_spread_home_margin);
  const marketHM=num(market?.home_margin);
  let model={...(g.model||{})};
  if(fairHM!==null&&marketHM!==null){
    const edge=Number((fairHM-marketHM).toFixed(1));
    model={...model,executable_edge:edge,edge_side:edge>0?cg.homeAbbr:edge<0?cg.awayAbbr:'NONE',edge_reconciled_at:now,edge_convention:'fair_spread_home_margin - market.home_margin'};
  }else{
    model={...model,executable_edge:null,edge_side:null,edge_reconciled_at:now,edge_convention:'UNAVAILABLE: fair or market home margin missing'};
  }
  return {...g,kickoff:row?.kickoff||g.kickoff,event_state:row?.completed?'final':'scheduled',market,model};
});

const nextCanonical={...canonical,updatedAt:now,marketSource:'Current ESPN NFL selected-week odds feed; exact sportsbook/juice required before execution',games:updatedCanonical,runtimeRefresh:{source:url,observedAt:now,espnEvents:rows.length,currentOddsGames:liveOdds,identityNormalization:'WSH/WAS and JAX/JAC normalized before canonical joins'}};
const nextLegacy={...legacy,generated_at:now,schedule_source:'Canonical selected-week NFL board + ESPN scoreboard reconciliation',market_source:'ESPN selected-week odds feed; exact sportsbook/juice required before execution',games:updatedLegacy,runtime_refresh:{source:url,observed_at:now,espn_events:rows.length,current_odds_games:liveOdds,identity_normalization:'WSH/WAS and JAX/JAC normalized before canonical joins',edge_reconciliation:'Every legacy portal executable edge recomputed from fair_spread_home_margin - current market.home_margin'}};
await fs.writeFile(canonicalPath,JSON.stringify(nextCanonical,null,2)+'\n');
await fs.writeFile(legacyPath,JSON.stringify(nextLegacy,null,2)+'\n');
console.log(`NFL live portal runtime refreshed: slate=${rows.length}, currentOdds=${liveOdds}, completed=${rows.filter(x=>x.completed).length}; portal edges reconciled=${updatedLegacy.filter(g=>g.model?.edge_reconciled_at===now).length}`);
