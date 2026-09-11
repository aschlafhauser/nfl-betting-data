import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const board=await read('data/weekly-board.json');
const registry=await read('data/team-identity-registry.json');
const raw=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const aliasToAbbr=new Map(), ambiguities=[];
for(const t of registry.teams||[]){for(const a of [t.abbr,t.canonical,...(t.aliases||[])]){const k=raw(a);if(!k)continue;const prior=aliasToAbbr.get(k);if(prior&&prior!==t.abbr)ambiguities.push({alias:a,abbrs:[prior,t.abbr]});aliasToAbbr.set(k,t.abbr)}}
const norm=v=>aliasToAbbr.get(raw(v))||null;
const failures=[];
if((registry.teams||[]).length!==32)failures.push(`NFL_IDENTITY_REGISTRY_SIZE: expected 32, got ${(registry.teams||[]).length}`);
for(const a of ambiguities)failures.push(`NFL_IDENTITY_AMBIGUOUS_ALIAS: ${a.alias} -> ${a.abbrs.join('/')}`);
const games=board.games||[],seenBoard=new Set();
for(const g of games){for(const [side,name,abbr] of [['away',g.away,g.awayAbbr],['home',g.home,g.homeAbbr]]){const n=norm(abbr)||norm(name);if(!n)failures.push(`NFL_IDENTITY_UNRESOLVED_BOARD: ${g.gameId} ${side} ${name} / ${abbr}`);else if(n!==String(abbr||'').toUpperCase())failures.push(`NFL_IDENTITY_NONCANONICAL_BOARD_ABBR: ${g.gameId} ${abbr} -> ${n}`);seenBoard.add(n||abbr)}}
const url=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${board.season||2026}&seasontype=2&week=${board.week}&limit=100`;
const r=await fetch(url,{headers:{accept:'application/json','user-agent':'nfl-team-identity-audit/1.0'}});if(!r.ok)throw new Error(`ESPN identity audit fetch HTTP ${r.status}`);const payload=await r.json();
const espnRows=[];
for(const ev of payload.events||[]){const cs=ev?.competitions?.[0]?.competitors||[];const a=cs.find(x=>x.homeAway==='away'),h=cs.find(x=>x.homeAway==='home');if(!a||!h)continue;const aa=norm(a.team?.abbreviation)||norm(a.team?.displayName),hh=norm(h.team?.abbreviation)||norm(h.team?.displayName);espnRows.push({eventId:String(ev.id),away:aa,home:hh,awayRaw:a.team?.abbreviation,homeRaw:h.team?.abbreviation});if(!aa)failures.push(`NFL_IDENTITY_UNRESOLVED_ESPN: ${ev.id} away ${a.team?.displayName}/${a.team?.abbreviation}`);if(!hh)failures.push(`NFL_IDENTITY_UNRESOLVED_ESPN: ${ev.id} home ${h.team?.displayName}/${h.team?.abbreviation}`)}
const boardPairs=new Map(games.map(g=>[`${g.awayAbbr}__${g.homeAbbr}`,g.gameId]));const matched=[];
for(const row of espnRows){const key=`${row.away}__${row.home}`;const gid=boardPairs.get(key);if(!gid)failures.push(`NFL_IDENTITY_JOIN_MISS: ESPN ${row.eventId} ${row.awayRaw}-${row.homeRaw} => ${key}`);else matched.push(gid)}
if(new Set(matched).size!==games.length)failures.push(`NFL_IDENTITY_SLATE_JOIN: matched ${new Set(matched).size}/${games.length} canonical games`);
const report={season:board.season||2026,week:board.week,checkedAt:new Date().toISOString(),registryVersion:registry.version,registryTeams:(registry.teams||[]).length,boardGames:games.length,espnEvents:espnRows.length,matchedGames:new Set(matched).size,failures,status:failures.length?'FAIL':'PASS'};
await fs.writeFile('data/team-identity-audit-current.json',JSON.stringify(report,null,2)+'\n');
console.log(`NFL identity audit ${report.status}: board=${games.length}, ESPN=${espnRows.length}, matched=${report.matchedGames}, failures=${failures.length}`);if(failures.length){console.error(failures.join('\n'));process.exit(1)}
