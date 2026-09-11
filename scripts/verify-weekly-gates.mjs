import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const board=await read('data/weekly-board.json');
const season=Number(board.season||2026),week=Number(board.week);
const manifest=await read(`data/weekly-manifest-${season}-w${week}.json`);
const failures=[];
const warnings=[];
if(Number(manifest.season)!==season||Number(manifest.week)!==week)failures.push('Manifest selected week does not match canonical Weekly Board');
for(const [name,gate] of Object.entries(manifest.gates||{})){
  const status=String(gate.status||'').toUpperCase();
  if(status==='FAIL')failures.push(`${name}: failed`);
  else if(status.includes('WARN')||status==='HISTORICAL-FAIL')warnings.push(`${name}: ${gate.note||status}`);
}
if(String(manifest.status||'').toUpperCase()==='FAIL')failures.push(...(manifest.failures||[]));
warnings.push(...(manifest.historicalWarnings||[]));
if(Number(manifest.gates?.canonicalSchedule?.actualGames||0)!==Number(manifest.gates?.canonicalSchedule?.expectedGames||0))failures.push('Canonical schedule count mismatch');
if(Number(manifest.gates?.deepDiveCoverage?.completed||0)!==Number(manifest.gates?.deepDiveCoverage?.expected||0))failures.push('Deep Dive count mismatch');
if(Number(manifest.gates?.structuredPerGameReview?.classifiedGames||0)!==Number(manifest.gates?.structuredPerGameReview?.expected||0))failures.push('Per-game dossier/classification count mismatch');
if(Number(manifest.gates?.matchupMatrix?.pointImpact)!==0)failures.push('Research-only matchup diagnostics have nonzero production impact');
if(Number(manifest.gates?.upsetResearchIsolation?.productionFairImpact)!==0||Number(manifest.gates?.upsetResearchIsolation?.modelWeightImpact)!==0||Number(manifest.gates?.upsetResearchIsolation?.officialLedgerImpact)!==0||Number(manifest.gates?.upsetResearchIsolation?.unitsImpact)!==0)failures.push('NFL upset research isolation violated');
const status=failures.length?'FAIL':warnings.length?'PASS-WITH-WARNINGS':'PASS';
console.log(JSON.stringify({season,week,status,manifestStatus:manifest.status,failures,warnings},null,2));
if(failures.length)process.exit(1);
