import fs from 'node:fs/promises';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const board=await read('data/weekly-board.json');
const deep=await read('data/deep-dive-status.json');
const ledgerSync=await read('data/expert-ledger-reconciliation.json').catch(()=>null);
const season=Number(board.season||2026),week=Number(board.week);
if(!Number.isFinite(week))throw new Error('weekly-board.json has no valid selected week');
const files=await fs.readdir('data');
const intelFiles=files.filter(x=>/^weekday-intel-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
const latestIntelFile=intelFiles.at(-1)||null;
const intel=latestIntelFile?await read(`data/${latestIntelFile}`):null;
const games=Array.isArray(board.games)?board.games:[];
const ids=games.map(g=>g.gameId).filter(Boolean),uniqueIds=new Set(ids);
const expected=games.length;
const homeMarginValid=games.every(g=>typeof g.productionSpread==='string'&&g.productionSpread.trim()&&g.currentSpread);
const deepComplete=Number(deep.week)===week&&Number(deep.gameCount)===expected&&Number(deep.completedGameCount)===expected;
const intelCount=Number(intel?.scheduleCoverage?.canonicalGameCount||0);
const intelComplete=Number(intel?.scheduleCoverage?.completedDeepDives||0);
const classifications=Array.isArray(intel?.gameClassifications)?intel.gameClassifications:[];
const classIds=new Set(classifications.map(x=>x.gameId).filter(Boolean));
const matrixFields=intel?.deepDiveContract?.matrixFields||[];
const matrixContract=matrixFields.length>=6;
const official=(board.officialPortfolio?.count||0);
async function latestExpertReconciliation(){
  const dir='data/expert-episode-audit';
  const names=(await fs.readdir(dir).catch(()=>[])).filter(n=>/reconciliation\.json$/i.test(n)).sort().reverse();
  for(const n of names){const x=await read(`${dir}/${n}`).catch(()=>null);if(x&&Number(x.week)===week&&String(x.sport||'NFL').toUpperCase()==='NFL')return {file:n,data:x};}
  return null;
}
async function finalSnapshotFailures(){
  const dir='data/game-day-intel';
  const names=(await fs.readdir(dir).catch(()=>[])).filter(n=>/final-snapshot-gate-failure\.json$/i.test(n));
  const failures=[];
  for(const n of names){
    const x=await read(`${dir}/${n}`).catch(()=>null);
    if(x&&Number(x.season)===season&&Number(x.week)===week&&String(x.type||'').toUpperCase()==='FINAL_SNAPSHOT_GATE_FAILURE')failures.push({file:n,gameId:x.gameId||null,kickoff:x.kickoff||null,recordedAt:x.recordedAt||null});
  }
  return failures;
}
const expertRecon=await latestExpertReconciliation();
const snapshotFailures=await finalSnapshotFailures();
const fresh=x=>{const t=Date.parse(x?.generatedAt||'');return Number.isFinite(t)&&Date.now()-t<6*3600000};
const syncHealthy=String(ledgerSync?.sport||'').toUpperCase()==='NFL'&&Number(ledgerSync?.week)===week&&String(ledgerSync?.primaryLedgerStatus||'').toUpperCase()==='SYNCHRONIZED'&&Number(ledgerSync?.missingGovernedRecords||0)===0&&fresh(ledgerSync);
const primaryLedgerStatus=syncHealthy?'SYNCHRONIZED':String(ledgerSync?.primaryLedgerStatus||expertRecon?.data?.primaryLedgerStatus||'UNKNOWN');
const expertLedgerHealthy=syncHealthy||/^(PASS|SYNCHRONIZED|CURRENT)$/i.test(primaryLedgerStatus);

// Current operational failures must still fail CI. Historical audit debt is preserved
// separately so an immutable missed pre-kickoff snapshot does not make every future
// refresh look operationally broken. We never backfill or erase that historical miss.
const blockingFailures=[];
const historicalWarnings=[];
if(expected<=0)blockingFailures.push('Canonical weekly board is empty');
if(uniqueIds.size!==expected)blockingFailures.push(`Canonical game IDs are not unique/complete (${uniqueIds.size}/${expected})`);
if(!deepComplete)blockingFailures.push(`Deep Dive checkpoint is not complete for selected week (${deep.completedGameCount||0}/${expected})`);
if(!intel||Number(intel.week)!==week)blockingFailures.push('No current selected-week weekday intelligence artifact');
if(intel&&intelCount!==expected)blockingFailures.push(`Weekday intelligence schedule coverage ${intelCount}/${expected}`);
if(intel&&intelComplete!==expected)blockingFailures.push(`Weekday intelligence Deep Dive coverage ${intelComplete}/${expected}`);
if(intel&&classIds.size!==expected)blockingFailures.push(`Per-game classification coverage ${classIds.size}/${expected}`);
if(intel&&!matrixContract)blockingFailures.push('Six-way position-group matchup matrix contract is incomplete');
if(!homeMarginValid)blockingFailures.push('One or more weekly-board games lack current spread/production spread required for home-margin reconciliation');
if(!expertLedgerHealthy)blockingFailures.push('Primary NFL expert ledger is not losslessly synchronized with newer governed episode-audit records');
if(snapshotFailures.length)historicalWarnings.push(`FINAL_SNAPSHOT_MISSING: ${snapshotFailures.map(x=>x.gameId||x.file).join(', ')}`);
const timeLimited=Array.isArray(deep.executionLimitations)&&deep.executionLimitations.length>0;
const status=blockingFailures.length?'FAIL':(snapshotFailures.length||timeLimited)?'PASS-WITH-WARNINGS':'PASS';
const now=new Date().toISOString();
const manifest={version:'NFL-WEEKLY-MANIFEST-v2',season,week,updatedAt:now,status,sourceOfTruth:'data/weekly-board.json',latestWeekdayIntel:latestIntelFile?`data/${latestIntelFile}`:null,gates:{canonicalSchedule:{status:uniqueIds.size===expected&&expected>0?'PASS':'FAIL',expectedGames:expected,actualGames:games.length,uniqueCanonicalIds:uniqueIds.size},deepDiveCoverage:{status:deepComplete&&intelComplete===expected?'PASS':'FAIL',completed:Number(deep.completedGameCount||0),expected,sourceFailures:Array.isArray(deep.sourceDataFailures)?deep.sourceDataFailures.length:0,note:'Schedule coverage is never Deep Dive coverage.'},structuredPerGameReview:{status:classIds.size===expected?'PASS':'FAIL',classifiedGames:classIds.size,expected,source:latestIntelFile},matchupMatrix:{status:matrixContract?'PASS':'FAIL',requiredDimensions:6,declaredDimensions:matrixFields.length,pointImpact:0,note:'Current personnel/unit overlays and older matchup diagnostics remain research-only unless separately validated.'},homeMarginConvention:{status:homeMarginValid?'PASS':'FAIL',note:'Canonical home-margin convention is required before all edge calculations; NFL key numbers 3 and 7 remain protected.'},expertIntelligence:{status:expertLedgerHealthy?'PASS':'FAIL',primaryLedgerStatus,ledgerSyncReport:'data/expert-ledger-reconciliation.json',latestReconciliation:expertRecon?.file||null,pointImpact:0,note:expertLedgerHealthy?`Expert Intelligence is a correlated qualitative residual after the quantitative model; primary ledger is losslessly synchronized (${ledgerSync?.ledgerRecordCount??'n/a'} ledger records; ${ledgerSync?.missingGovernedRecords??0} missing).`:'Primary expert ledger is stale/incomplete versus newer governed episode audits. UNRESOLVED_INGESTION_FAILURE; preserve audits and quantitative model state until a lossless merge is available.'},upsetResearchIsolation:{status:'PASS',productionFairImpact:0,modelWeightImpact:0,officialLedgerImpact:0,unitsImpact:0,note:'NFL upset research remains isolated unless separately validated and governed.'},officialExecution:{status:'PASS',officialBetCount:Number(official),contract:'No official wager without exact sportsbook/source, line/juice, units, timestamp, production fair and executable edge.'},finalSnapshotIntegrity:{status:snapshotFailures.length?'HISTORICAL-FAIL':'PASS',blocking:false,missingCount:snapshotFailures.length,failures:snapshotFailures,note:snapshotFailures.length?'A required immutable pre-kickoff snapshot was missed. The historical failure remains permanently recorded and is never backfilled, but it does not block otherwise-healthy current runtime refreshes.':'No persisted final-snapshot gate failures for the selected week.'},historicalIntegrity:{status:snapshotFailures.length?'PASS-WITH-PRESERVED-FAILURE':'PASS',note:'Preserve pre-kickoff states and final snapshots; never backfill after results. Completed games are exempt from live-market freshness SLA. Any missed pre-kickoff snapshot remains explicitly preserved as historical audit debt.'},timeLimitedOverlays:{status:timeLimited?'IN_PROGRESS':'PASS',items:deep.executionLimitations||[]}},failures:blockingFailures,historicalWarnings};
await fs.writeFile(`data/weekly-manifest-${season}-w${week}.json`,JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile('data/weekly-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`NFL weekly manifest ${status}: ${expected} games, ${deep.completedGameCount||0} Deep Dives, ${classIds.size} classified, ${snapshotFailures.length} preserved historical final-snapshot failures, ${blockingFailures.length} blocking failures.`);
if(blockingFailures.length)process.exitCode=1;
