import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile(`data/${p}`,'utf8'));
const write=async(p,x)=>fs.writeFile(`data/${p}`,JSON.stringify(x,null,2)+'\n');
const board=await read('weekly-board.json'),deep=await read('nfl-deep-dives.json'),upset=await read('nfl-upset-lab.json');
const byId=new Map(board.games.map(g=>[g.gameId,g])),now=new Date().toISOString();
for(const d of deep.dossiers||[]){
 const g=byId.get(d.canonicalGameId);if(!g||g.eventState==='final')continue;
 const line=`Current governed structural fair: ${g.validatedStructuralSpread}; production fair: ${g.productionSpread}; current market: ${g.currentSpread}.`;
 d.model={...d.model,spread:g.productionSpread,homeMargin:g.productionHomeMargin,structural:g.validatedStructuralSpread,structuralEdge:g.structuralEdge,total:g.productionTotal};
 d.mechanisms=[line,...(d.mechanisms||[]).filter(x=>!/^(Frozen v1\.1|Current governed) structural fair:/.test(x))];
 d.summary=d.mechanisms.join(' ');d.mechanism=line;d.modelCalculatedAt=g.modelCalculatedAt;
}
for(const x of upset.candidates||[]){
 const g=byId.get(x.game_id);if(!g||g.eventState==='final')continue;
 x.structuralFair=g.validatedStructuralSpread;
 const criterion=(x.criteria||[]).find(c=>c.name==='structural-resistance');
 if(criterion){criterion.passed=g.structuralLean===x.team;criterion.status=criterion.passed?'PASS':'FAIL';criterion.evidence=`Current structural lean ${g.structuralLean||'NONE'}; structural fair ${g.validatedStructuralSpread}.`;}
}
deep.generatedAt=now;upset.narrativeReconciledAt=now;
await write('nfl-deep-dives.json',deep);await write('nfl-upset-lab.json',upset);
console.log('Unplayed-game narratives reconciled to final governed model; completed evidence preserved.');
