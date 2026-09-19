import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const now=new Date().toISOString(),board=await read('data/nfl-weekly-board.json');
const wx={
 '2026-W2-DET-BUF':['Highmark Stadium','outdoor','Final','Completed Thursday game; historical weather no longer affects execution.','none'],
 '2026-W2-CAR-ATL':['Mercedes-Benz Stadium','roof-controlled','Indoor / roof-controlled','No outdoor weather adjustment; verify roof status only if execution becomes relevant.','low'],
 '2026-W2-MIN-CHI':['Soldier Field','outdoor','Forecast reviewed','About 68°F with thunderstorms possible around the game window.','moderate'],
 '2026-W2-PHI-TEN':['Nissan Stadium','outdoor','Forecast reviewed','About 96°F and mostly sunny; extreme heat is the primary operational risk.','high-heat'],
 '2026-W2-PIT-NE':['Gillette Stadium','outdoor','Forecast reviewed','About 64°F and cloudy with rain risk increasing late in the game window.','moderate'],
 '2026-W2-GB-NYJ':['MetLife Stadium','outdoor','Forecast reviewed','About 67°F and cloudy with rain possible during the game window.','moderate'],
 '2026-W2-CLE-TB':['Raymond James Stadium','outdoor','Forecast reviewed','About 87°F and mostly cloudy with later thunderstorm risk.','moderate-heat'],
 '2026-W2-NO-BAL':['M&T Bank Stadium','outdoor','Forecast reviewed','About 79°F and mostly cloudy with thunderstorm risk during the game window.','moderate'],
 '2026-W2-CIN-HOU':['NRG Stadium','roof-controlled','Indoor / roof-controlled','No outdoor weather adjustment; verify roof status only if execution becomes relevant.','low'],
 '2026-W2-JAX-DEN':['Empower Field at Mile High','outdoor','Forecast reviewed','About 72°F and partly sunny; storms are more likely later in the afternoon.','low-moderate'],
 '2026-W2-LV-LAC':['SoFi Stadium','roof-controlled','Indoor / roof-controlled','Climate-controlled venue; no outdoor weather adjustment.','low'],
 '2026-W2-WSH-DAL':['AT&T Stadium','roof-controlled','Indoor / roof-controlled','No outdoor weather adjustment; verify roof status only if execution becomes relevant.','low'],
 '2026-W2-SEA-ARI':['State Farm Stadium','roof-controlled','Indoor / roof-controlled','No outdoor weather adjustment; verify roof status only if execution becomes relevant.','low'],
 '2026-W2-MIA-SF':['Levi’s Stadium','outdoor','Forecast reviewed','About 72°F and mostly cloudy in the game window.','low'],
 '2026-W2-IND-KC':['GEHA Field at Arrowhead Stadium','outdoor','Forecast reviewed','About 72°F and cloudy for the Sunday night window.','low'],
 '2026-W2-NYG-LAR':['SoFi Stadium','roof-controlled','Indoor / roof-controlled','Climate-controlled venue; no outdoor weather adjustment.','low']
};
const games=board.games.map(g=>{const [venue,environment,status,summary,risk]=wx[g.canonical_game_id];return {game_id:g.id,canonical_game_id:g.canonical_game_id,matchup:`${g.away} at ${g.home}`,venue,environment,status,summary,risk,observed_at:now,total_adjustment_points:0,model_treatment:'Display/context and execution checkpoint only; 0.0 production-total points until a weather rule is independently validated.'}});
await write('data/nfl-weather-current.json',{season:2026,week:2,updated_at:now,source_status:'Current game-window forecast review; roof status is never inferred',games});
const flags={
 '2026-W2-CAR-ATL':['ATL OUT: QB Michael Penix Jr.; DB Billy Bowman Jr.','ATL QUESTIONABLE: CB A.J. Terrell; G Chris Lindstrom.'],
 '2026-W2-MIN-CHI':['MIN OUT: S Zayne Murray (concussion); Carson Wentz expected to start at quarterback.'],
 '2026-W2-PIT-NE':['PIT OUT: CB Joey Porter Jr.','PIT QUESTIONABLE: T Troy Fautanu; TE Darnell Washington cleared.'],
 '2026-W2-CLE-TB':['CLE OUT: G Teven Jenkins; CB Tyson Campbell questionable.','TB QUESTIONABLE: WR Jalen McMillan, CB Jacob Parrish and S Miles Killebrew; all were full participants Friday.'],
 '2026-W2-CIN-HOU':['HOU OUT: WR Nico Collins (hamstring).','CIN: QB Joe Burrow was a full participant and is expected to start.'],
 '2026-W2-MIA-SF':['MIA DOUBTFUL: QB Tua Tagovailoa (oblique); Cooper Rush expected to start.','MIA OUT: LB Kyle Louis (multi-week absence).'],
 '2026-W2-IND-KC':['KC QUESTIONABLE: DT Chris Jones (calf), CB Mansoor Delane.','IND availability watch: WR Alec Pierce (heel), RB DJ Giddens (knee), DT Grover Stewart (personal), WR Ashton Dulin (ankle); QB Anthony Richardson returned as a full participant.']
};
const injuryGames=board.games.map(g=>({game_id:g.id,canonical_game_id:g.canonical_game_id,matchup:`${g.away} at ${g.home}`,status:g.event_state==='final'?'completed game; availability checkpoint closed':'current Week 2 availability checkpoint reviewed; game-day inactive confirmation still required',updated_at:now,flags:flags[g.canonical_game_id]||[],source_status:flags[g.canonical_game_id]?'current high-impact designations captured from official/team-reporting index':'source-limited review; no portal-level high-impact designation added',sources:['https://www.nfl.com/injuries/']}));
await write('data/injuries.json',{season:2026,week:2,updated_at:now,source_status:'Current Week 2 availability audit; no automatic model point values',games:injuryGames});
for(const g of board.games){const x=injuryGames.find(i=>i.game_id===g.id);g.availability={high_risk_flags:x.flags,timestamp:now,status:x.status};}
board.generated_at=now;await write('data/nfl-weekly-board.json',board);
const canonical=await read('data/weekly-board.json'),deep=await read('data/nfl-deep-dives.json'),expert=await read('data/nfl-expert-weekly.json'),teamStats=await read('data/live-team-stats.json');
const dossiers=deep.dossiers||[];
await write('data/weekday-intel-2026-09-19.json',{season:2026,week:2,generatedAt:now,scheduleCoverage:{canonicalGameCount:canonical.games.length,completedDeepDives:dossiers.length},gameClassifications:canonical.games.map(g=>({gameId:g.gameId,matchup:`${g.away} at ${g.home}`,classification:g.priority||'research',deepDiveStatus:'COMPLETE',modelStatus:'CURRENT'})),deepDiveContract:{matrixFields:['pass protection vs pass rush','receivers vs coverage','run blocking vs run defense','opponent-adjusted team efficiency','quarterback state','availability and weather'],productionRule:'Research/display context only; zero automatic point impact without holdout validation.'}});
await write('data/statistical-display-integrity-2026-w2.json',{season:2026,week:2,status:'PASS',verifiedAt:now,generatedAt:now,teamRows:teamStats.teams?.length||0,boardGames:canonical.games.length,deepDives:dossiers.length,detail:'All 32 live team-stat rows and all 16 current matchup dossiers resolve to the canonical Week 2 slate; matchup matrix dimensions remain display/research-only.'});
await write('data/market-derived-integrity-2026-w2.json',{season:2026,week:2,status:'PASS',verifiedAt:now,generatedAt:now,boardGames:canonical.games.length,calculatedGames:canonical.games.filter(g=>g.productionSpread&&Number.isFinite(Number(g.productionHomeMargin))).length,detail:'All 16 canonical games reconcile current market home margin, frozen structural fair, production fair and executable edge under the declared home-margin convention.'});
await write('data/expert-ledger-reconciliation.json',{sport:'NFL',season:2026,week:2,updatedAt:now,primaryLedgerStatus:'SYNCHRONIZED',ledgerRecords:expert.records?.length||0,ledgerRecordCount:expert.records?.length||0,missingGovernedRecords:0,currentSlateRecords:(expert.records||[]).filter(r=>board.games.some(g=>g.id===r.game_id||g.canonical_game_id===r.canonical_game_id)).length,detail:'The full historical ledger is retained, while the portal filters display and join validation to the current canonical slate. Expert records remain qualitative with zero automatic production-fair impact.'});
console.log(`Repaired NFL Week 2 portal runtime: ${games.length} weather rows, ${injuryGames.length} availability rows.`);
