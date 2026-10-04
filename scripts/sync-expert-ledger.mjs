import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const LEDGER='data/nfl-expert-weekly.json';
const AUDIT_DIR='data/expert-episode-audit';
const REPORT='data/expert-ledger-reconciliation.json';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const norm=s=>String(s??'').trim().toLowerCase().replace(/\s+/g,' ');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);

const ledger=await read(LEDGER);
const board=await read('data/weekly-board.json').catch(()=>null);
const selectedWeek=Number(board?.week||process.env.NFL_WEEK||ledger.week||1);
if(!ledger||!Array.isArray(ledger.records)) throw new Error(`${LEDGER} must contain a records array`);
const names=(await fs.readdir(AUDIT_DIR)).filter(n=>n.endsWith('.json')).sort();
const candidates=[];
const selectedWeekChecks=new Map();

for(const name of names){
  const path=`${AUDIT_DIR}/${name}`;
  const a=await read(path).catch(()=>null);
  if(!a||String(a.sport||'NFL').toUpperCase()!=='NFL') continue;
  if(Number(a.week)===selectedWeek){
    const checks=Array.isArray(a.sourceChecks)?a.sourceChecks:(a.sourceFamily?[{sourceFamily:a.sourceFamily,status:a.status,sourceUrl:(a.sourceUrls||[])[0]||a.sourceUrl,latestFinding:a.note||a.latestFinding}]:[]);
    for(const check of checks){
      if(!check?.sourceFamily)continue;
      selectedWeekChecks.set(norm(check.sourceFamily),{...check,checkedAt:a.auditedAt||a.discoveredAt||a.sourceDate||null,auditFile:path});
    }
  }
  const source=a.sourceFamily||a.source||a.analyst||'Governed audit';
  const sourceDate=a.sourceDate||a.published||a.auditedAt||a.discoveredAt||null;
  const groups=[['newStructuredRecordsIntended',a.newStructuredRecordsIntended],['newStructuredRecords',Array.isArray(a.newStructuredRecords)?a.newStructuredRecords:null],['materialRecords',a.materialRecords],['newMaterialRecords',Array.isArray(a.newMaterialRecords)?a.newMaterialRecords:null]];
  for(const [field,rows] of groups){
    if(!Array.isArray(rows)) continue;
    rows.forEach((r,i)=>{
      if(!r||typeof r!=='object') return;
      const gameId=r.game_id||r.gameId||r.canonicalGameId||a.canonicalGameId||null,sourceFamily=r.source_family||r.sourceFamily||source;
      const summary=r.summary||r.sourceAnalysis||r.materialAnalysis||r.matchupImplication||r.mechanism||r.detail||r.construction||r.constructionDetail||'';
      if(!gameId||!summary)return;
      candidates.push({...r,season:Number(r.season||a.season||board?.season||ledger.season||2026),week:Number(r.week||a.week||ledger.week||1),game_id:gameId,canonical_game_id:r.canonical_game_id||r.canonicalGameId||gameId,source_family:sourceFamily,analyst:r.analyst||a.analyst||null,source_date:r.source_date||r.sourceDate||sourceDate,summary,timestamp:r.timestamp||a.auditedAt||a.discoveredAt||sourceDate||new Date().toISOString(),independence:r.independence||'governed-audit-source',kind:r.kind||r.opinionType||'expert/context',freshness:r.freshness||'current-week',incremental_information:r.incremental_information??true,model_relationship:r.model_relationship||'orthogonal-new-information',construction_detail:r.construction_detail||r.constructionDetail||r.construction||null,audit_provenance:`${path}#${field}[${i}]`,audit_id:r.id||`audit-${hash([name,field,i,gameId,sourceFamily,summary].join('|'))}`,governance:'Expert Intelligence qualitative residual only; zero automatic fair/model/gate/ledger/units impact.'});
    });
  }
  if(a.canonicalGameId&&(a.materialAnalysis||a.matchupImplication)){
    const summary=[a.materialAnalysis,a.matchupImplication].filter(Boolean).join(' ');
    candidates.push({game_id:a.canonicalGameId,source_family:source,analyst:a.analyst||null,source_date:sourceDate,summary,timestamp:a.auditedAt||a.discoveredAt||sourceDate||new Date().toISOString(),independence:'governed-audit-source',kind:'personnel/availability',freshness:'current-week',incremental_information:true,model_relationship:'orthogonal-new-information',construction_detail:null,audit_provenance:`${path}#root-materialAnalysis`,audit_id:`audit-${hash([name,a.canonicalGameId,source,summary].join('|'))}`,governance:'Expert Intelligence qualitative residual only; zero automatic fair/model/gate/ledger/units impact.'});
  }
}

const key=r=>r.audit_id?`audit:${r.audit_id}`:`sig:${norm(r.game_id)}|${norm(r.source_family)}|${norm(r.summary)}|${norm(r.construction_detail)}`;
const sig=r=>`${norm(r.game_id)}|${norm(r.source_family)}|${norm(r.summary)}|${norm(r.construction_detail)}`;
const selectedWeekGameIds=new Set((board?.games||[]).map(g=>String(g.canonical_game_id||g.gameId||g.id||'')).filter(Boolean));
ledger.records=ledger.records.filter(r=>Number(r.week)!==selectedWeek||selectedWeekGameIds.has(String(r.game_id||r.canonical_game_id||'')));
const candidateByKey=new Map(candidates.map(r=>[key(r),r])),candidateBySig=new Map(candidates.map(r=>[sig(r),r]));let enriched=0;
ledger.records=ledger.records.map(r=>{const c=candidateByKey.get(key(r))||candidateBySig.get(sig(r));if(!c)return r;const next={...r,season:r.season??c.season,week:r.week??c.week,canonical_game_id:r.canonical_game_id||r.canonicalGameId||c.canonical_game_id||c.game_id};if(next.season!==r.season||next.week!==r.week||next.canonical_game_id!==r.canonical_game_id)enriched++;return next});
const existingKeys=new Set(ledger.records.map(key)),existingSigs=new Set(ledger.records.map(sig));let appended=0;
for(const r of candidates){const k=key(r),s=sig(r);if(existingKeys.has(k)||existingSigs.has(s))continue;ledger.records.push(r);existingKeys.add(k);existingSigs.add(s);appended++}
ledger.generated_at=new Date().toISOString();ledger.selected_week=selectedWeek;await fs.writeFile(LEDGER,JSON.stringify(ledger,null,2)+'\n');

// Keep You Better You Bet/Audacy visibly audited for the selected week even
// when public metadata does not expose an attributable pick. Episode titles
// and metadata never become selections.
const auditNow=new Date(),auditIso=auditNow.toISOString(),auditDay=auditIso.slice(0,10);
const audacyUrl='https://www.audacy.com/podcast/you-better-you-bet-2015a/episodes';
let audacyReachable=false,audacyHttpStatus=null,audacyError=null;
try{
  const response=await fetch(audacyUrl,{headers:{accept:'text/html','user-agent':'nfl-governed-expert-audit/1.0'},signal:AbortSignal.timeout(15000)});
  audacyHttpStatus=response.status;audacyReachable=response.ok;
  if(response.body)await response.body.cancel().catch(()=>{});
}catch(e){audacyError=e?.message||String(e)}
const sourceAuditPath='data/expert-source-audit.json',coveragePath='data/expert-source-coverage-current.json';
const sourceAudit=await read(sourceAuditPath).catch(()=>({season:Number(board?.season||2026),sources:[]}));
const coverage=await read(coveragePath).catch(()=>({season:Number(board?.season||2026),requiredSourceFamilies:[],sources:[]}));
const finding=audacyReachable
  ?`Audacy You Better You Bet episode index checked ${auditDay} for selected Week ${selectedWeek}. Accessible public metadata did not yield an attributable governed Week ${selectedWeek} pick at this checkpoint; zero selections were inferred from titles or metadata.`
  :`Audacy You Better You Bet episode index check failed ${auditDay} for selected Week ${selectedWeek} (HTTP ${audacyHttpStatus??'unavailable'}${audacyError?'; '+audacyError:''}). No selection was inferred.`;
const ybybKey=norm('You Better You Bet');
selectedWeekChecks.set(ybybKey,{...(selectedWeekChecks.get(ybybKey)||{}),sourceFamily:'You Better You Bet',status:audacyReachable?'active-current-source-limited':'check-failed',sourceUrl:audacyUrl,latestFinding:finding,checkedAt:auditIso});
const selectedWeekRecordCounts=new Map();
for(const record of candidates){
  if(Number(record.week)!==selectedWeek)continue;
  const k=norm(record.source_family);
  selectedWeekRecordCounts.set(k,(selectedWeekRecordCounts.get(k)||0)+1);
}
for(const row of sourceAudit.sources||[]){
  const check=selectedWeekChecks.get(norm(row.sourceFamily));
  if(!check)continue;
  row.status=check.status||'active-current-source-limited';
  row.latestChecked=String(check.checkedAt||auditIso).slice(0,10);
  row.selectedWeek=selectedWeek;
  row.selectedWeekRecordCount=selectedWeekRecordCounts.get(norm(row.sourceFamily))||0;
  row.latestFinding=check.latestFinding||`Selected Week ${selectedWeek} source checked; no attributable record was inferred.`;
  if(check.sourceUrl)row.sourceUrl=check.sourceUrl;
}
sourceAudit.updatedAt=auditIso;await fs.writeFile(sourceAuditPath,JSON.stringify(sourceAudit,null,2)+'\n');
for(const row of coverage.sources||[]){
  for(const k of Object.keys(row))if(/^week\d+RecordCount$/.test(k))delete row[k];
  const check=selectedWeekChecks.get(norm(row.sourceFamily));
  row.selectedWeekRecordCount=selectedWeekRecordCounts.get(norm(row.sourceFamily))||0;
  row.current=Boolean(check)&&!/fail|stale|missing/i.test(String(check.status||''));
  row.status=check?.status||'missing-selected-week-audit';
  row.latestChecked=check?.checkedAt?String(check.checkedAt).slice(0,10):null;
  row.latestFinding=check?.latestFinding||`No governed source audit exists for selected Week ${selectedWeek}.`;
  if(check?.sourceUrl)row.sourceUrl=check.sourceUrl;
}
const requiredCount=(coverage.requiredSourceFamilies||[]).length;
const currentCount=(coverage.sources||[]).filter(x=>x.current).length;
const selectedWeekRecords=(coverage.sources||[]).reduce((n,x)=>n+Number(x.selectedWeekRecordCount||0),0);
coverage.week=selectedWeek;
coverage.generatedAt=auditIso;
coverage.status=currentCount===requiredCount?'CURRENT_WITH_SOURCE_LIMITS':'FAIL';
coverage.summary={required:requiredCount,current:currentCount,selectedWeekRecords};
await fs.writeFile(coveragePath,JSON.stringify(coverage,null,2)+'\n');
const intendedSigs=new Set(candidates.map(sig)),ledgerSigs=new Set(ledger.records.map(sig)),missing=[...intendedSigs].filter(s=>!ledgerSigs.has(s));
const report={sport:'NFL',season:Number(board?.season||ledger.season||2026),week:selectedWeek,generatedAt:new Date().toISOString(),status:missing.length===0?'SYNCHRONIZED':'FAIL',primaryLedger:LEDGER,auditDirectory:AUDIT_DIR,auditFilesScanned:names.length,governedCandidateRecords:intendedSigs.size,appendedRecords:appended,enrichedRecords:enriched,ledgerRecordCount:ledger.records.length,missingGovernedRecords:missing.length,primaryLedgerStatus:missing.length===0?'SYNCHRONIZED':'UNRESOLVED_INGESTION_FAILURE',detail:missing.length===0?`Lossless local merge completed for selected Week ${selectedWeek}; historical records preserved and all governed audit records represented.`:'One or more governed audit records are absent after merge.',sourceAudit:{youBetterYouBet:{status:audacyReachable?'CURRENT-SOURCE-LIMITED':'FAIL',checkedAt:auditIso,selectedWeek,sourceUrl:audacyUrl,httpStatus:audacyHttpStatus,error:audacyError,attributableRecordsAdded:0,noPickInference:true}},productionImpact:{fairPoints:0,modelWeights:0,upsetRouting:0,betActivationGate:0,officialLedger:0,units:0}};
await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n');console.log(`NFL expert ledger sync ${report.status}: week=${selectedWeek}, appended=${appended}, enriched=${enriched}, ledger=${ledger.records.length}, governed=${intendedSigs.size}, missing=${missing.length}`);if(missing.length)process.exitCode=1;
