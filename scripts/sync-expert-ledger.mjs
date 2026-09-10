import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const LEDGER='data/nfl-expert-weekly.json';
const AUDIT_DIR='data/expert-episode-audit';
const REPORT='data/expert-ledger-reconciliation.json';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const norm=s=>String(s??'').trim().toLowerCase().replace(/\s+/g,' ');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);

const ledger=await read(LEDGER);
if(!ledger||!Array.isArray(ledger.records)) throw new Error(`${LEDGER} must contain a records array`);
const names=(await fs.readdir(AUDIT_DIR)).filter(n=>n.endsWith('.json')).sort();
const candidates=[];

for(const name of names){
  const path=`${AUDIT_DIR}/${name}`;
  const a=await read(path).catch(()=>null);
  if(!a||String(a.sport||'NFL').toUpperCase()!=='NFL') continue;
  const week=Number(a.week);
  const source=a.sourceFamily||a.source||a.analyst||'Governed audit';
  const sourceDate=a.sourceDate||a.published||a.auditedAt||a.discoveredAt||null;
  const groups=[
    ['newStructuredRecordsIntended',a.newStructuredRecordsIntended],
    ['newStructuredRecords',Array.isArray(a.newStructuredRecords)?a.newStructuredRecords:null],
    ['materialRecords',a.materialRecords],
    ['newMaterialRecords',Array.isArray(a.newMaterialRecords)?a.newMaterialRecords:null]
  ];
  for(const [field,rows] of groups){
    if(!Array.isArray(rows)) continue;
    rows.forEach((r,i)=>{
      if(!r||typeof r!=='object') return;
      const gameId=r.game_id||r.gameId||r.canonicalGameId||a.canonicalGameId||null;
      const sourceFamily=r.source_family||r.sourceFamily||source;
      const summary=r.summary||r.sourceAnalysis||r.materialAnalysis||r.matchupImplication||r.mechanism||r.detail||r.construction||r.constructionDetail||'';
      if(!gameId||!summary) return;
      candidates.push({
        ...r,
        game_id:gameId,
        source_family:sourceFamily,
        analyst:r.analyst||a.analyst||null,
        source_date:r.source_date||r.sourceDate||sourceDate,
        summary,
        timestamp:r.timestamp||a.auditedAt||a.discoveredAt||sourceDate||new Date().toISOString(),
        independence:r.independence||'governed-audit-source',
        kind:r.kind||r.opinionType||'expert/context',
        freshness:r.freshness||'current-week',
        incremental_information:r.incremental_information??true,
        model_relationship:r.model_relationship||'orthogonal-new-information',
        construction_detail:r.construction_detail||r.constructionDetail||r.construction||null,
        audit_provenance:`${path}#${field}[${i}]`,
        audit_id:r.id||`audit-${hash([name,field,i,gameId,sourceFamily,summary].join('|'))}`,
        governance:'Expert Intelligence qualitative residual only; zero automatic fair/model/gate/ledger/units impact.'
      });
    });
  }
  if(a.canonicalGameId&&(a.materialAnalysis||a.matchupImplication)){
    const summary=[a.materialAnalysis,a.matchupImplication].filter(Boolean).join(' ');
    candidates.push({
      game_id:a.canonicalGameId,
      source_family:source,
      analyst:a.analyst||null,
      source_date:sourceDate,
      summary,
      timestamp:a.auditedAt||a.discoveredAt||sourceDate||new Date().toISOString(),
      independence:'governed-audit-source',
      kind:'personnel/availability',
      freshness:'current-week',
      incremental_information:true,
      model_relationship:'orthogonal-new-information',
      construction_detail:null,
      audit_provenance:`${path}#root-materialAnalysis`,
      audit_id:`audit-${hash([name,a.canonicalGameId,source,summary].join('|'))}`,
      governance:'Expert Intelligence qualitative residual only; zero automatic fair/model/gate/ledger/units impact.'
    });
  }
}

const key=r=>r.audit_id?`audit:${r.audit_id}`:`sig:${norm(r.game_id)}|${norm(r.source_family)}|${norm(r.summary)}|${norm(r.construction_detail)}`;
const sig=r=>`${norm(r.game_id)}|${norm(r.source_family)}|${norm(r.summary)}|${norm(r.construction_detail)}`;
const existingKeys=new Set(ledger.records.map(key));
const existingSigs=new Set(ledger.records.map(sig));
let appended=0;
for(const r of candidates){const k=key(r),s=sig(r);if(existingKeys.has(k)||existingSigs.has(s))continue;ledger.records.push(r);existingKeys.add(k);existingSigs.add(s);appended++;}
ledger.generated_at=new Date().toISOString();
await fs.writeFile(LEDGER,JSON.stringify(ledger,null,2)+'\n');

const intendedSigs=new Set(candidates.map(sig));
const ledgerSigs=new Set(ledger.records.map(sig));
const missing=[...intendedSigs].filter(s=>!ledgerSigs.has(s));
const report={
  sport:'NFL',season:Number(ledger.season||2026),week:Number(ledger.week||1),generatedAt:new Date().toISOString(),
  status:missing.length===0?'SYNCHRONIZED':'FAIL',
  primaryLedger:LEDGER,auditDirectory:AUDIT_DIR,auditFilesScanned:names.length,
  governedCandidateRecords:intendedSigs.size,appendedRecords:appended,ledgerRecordCount:ledger.records.length,
  missingGovernedRecords:missing.length,
  primaryLedgerStatus:missing.length===0?'SYNCHRONIZED':'UNRESOLVED_INGESTION_FAILURE',
  detail:missing.length===0?'Lossless local merge completed from the full primary ledger plus governed episode-audit records; historical records were preserved and governed incremental records are represented.':'One or more governed audit records are still absent from the primary ledger after merge.',
  productionImpact:{fairPoints:0,modelWeights:0,upsetRouting:0,betActivationGate:0,officialLedger:0,units:0}
};
await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n');
console.log(`NFL expert ledger sync ${report.status}: appended=${appended}, ledger=${ledger.records.length}, governed=${intendedSigs.size}, missing=${missing.length}`);
if(missing.length) process.exitCode=1;
