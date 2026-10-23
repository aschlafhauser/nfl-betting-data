#!/usr/bin/env python3
"""Prospective NFL research leans. Never writes model fairs or official wagers."""
import argparse, csv, gzip, hashlib, json, math, os, statistics, urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
VERSION='1.0-team-leans-research'
ALIASES={'LA':'LAR','WSH':'WAS'}
def number(v):
    try:
        if v is None or v=='': return None
        n=float(v); return n if math.isfinite(n) else None
    except (TypeError,ValueError): return None
def date(v):
    try:
        d=datetime.fromisoformat(str(v).replace('Z','+00:00')); return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError,ValueError): return None
def mean(xs): return statistics.mean(xs) if xs else None
def rounded(v,n=4): return round(v,n) if v is not None else None
def read(data,name,default=None):
    try:return json.loads((data/name).read_text())
    except FileNotFoundError:return default if default is not None else {}
def write(data,name,obj):
    p=data/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,indent=2,allow_nan=False)+'\n')
def current(d,b):return d.get('season')==b.get('season') and d.get('week')==b.get('week')
def fresh(ts,now,hours):
    t=date(ts);return bool(t and 0<=(now-t).total_seconds()<=hours*3600)
def game_key(g):return g.get('canonical_game_id') or g.get('gameId') or g.get('canonicalGameId')
def row_for(d,g):return next((r for r in d.get('games',[]) if game_key(r)==game_key(g)),{})
def aggregate(rows,through):
    games=defaultdict(lambda:defaultdict(list)); weeks={}
    for r in rows:
        w=number(r.get('week'))
        if r.get('season_type')!='REG' or w is None or not 1<=w<=through:continue
        if r.get('play_type') not in ('pass','run') or number(r.get('qb_kneel'))==1 or number(r.get('qb_spike'))==1:continue
        a=ALIASES.get(r.get('posteam'),r.get('posteam'));h=ALIASES.get(r.get('defteam'),r.get('defteam'));e=number(r.get('epa'))
        if not a or not h or e is None:continue
        key=(r['game_id'],a,h);weeks[key]=int(w)
        games[key]['epa'].append(e)
        if number(r.get('down')) in (1,2):games[key]['early'].append(e)
        if number(r.get('qb_dropback'))==1 or r.get('play_type')=='pass':games[key]['pass'].append(e)
    # Leave each game out of its opponents' baseline; shrink small opponent samples
    # toward the league mean with 100 pseudo-plays. Diagnostic, not point calibrated.
    league=mean([v for d in games.values() for v in d['epa']]); profiles=defaultdict(dict)
    for window,start in [('season',1),('recent',max(1,through-2))]:
        by=defaultdict(lambda:defaultdict(list));ids=defaultdict(set)
        for key,metrics in games.items():
            gid,a,h=key
            if weeks[key]<start:continue
            ids[a].add(gid);ids[h].add(gid)
            for k,vs in metrics.items():by[a]['off_'+k]+=vs;by[h]['def_'+k]+=vs
            opp_def=[v for (og,oa,oh),d in games.items() if oh==h and og!=gid for v in d['epa']]
            opp_off=[v for (og,oa,oh),d in games.items() if oa==a and og!=gid for v in d['epa']]
            if league is not None:
                bd=(sum(opp_def)+100*league)/(len(opp_def)+100)
                bo=(sum(opp_off)+100*league)/(len(opp_off)+100)
                by[a]['adjustedOff'] += [v-bd+league for v in metrics['epa']]
                by[h]['adjustedDef'] += [v-bo+league for v in metrics['epa']]
        for a,m in by.items():
            o,d=mean(m['off_epa']),mean(m['def_epa']);ao,ad=mean(m['adjustedOff']),mean(m['adjustedDef'])
            profiles[a][window]={'games':len(ids[a]),'offPlays':len(m['off_epa']),'defPlays':len(m['def_epa']),'offEpa':rounded(o),'defEpa':rounded(d),'netEpa':rounded(o-d if o is not None and d is not None else None),'adjustedNetEpa':rounded(ao-ad if ao is not None and ad is not None else None),'earlyOffEpa':rounded(mean(m['off_early'])),'earlyDefEpa':rounded(mean(m['def_early'])),'passOffEpa':rounded(mean(m['off_pass'])),'passDefEpa':rounded(mean(m['def_pass']))}
    return dict(profiles)
def mechanism_rows(g,teams):
    a,h=teams.get(g['away_abbr'],{}),teams.get(g['home_abbr'],{});out=[]
    # One football-performance family: these related splits are explanations, not votes.
    specs=[('Passing efficiency','dropbackEpa','dropbackEpaAllowed',1),('Early-down efficiency','earlyDownEpa','earlyDownEpaAllowed',1),('Rushing efficiency','rushEpa','rushEpaAllowed',1),('Explosive plays','explosivePlayRate','explosivePlayRateAllowed',100)]
    for label,ok,dk,scale in specs:
        vals=[number(a.get('offense',{}).get(ok)),number(h.get('defense',{}).get(dk)),number(h.get('offense',{}).get(ok)),number(a.get('defense',{}).get(dk))]
        if any(v is None for v in vals):continue
        ao,hd,ho,ad=vals;gap=((ao+hd)-(ho+ad))/2
        out.append({'name':label,'side':g['away_abbr'] if gap>0 else g['home_abbr'] if gap<0 else None,'gap':rounded(abs(gap)*scale,3),'unit':'percentage points' if scale==100 else 'EPA/play','awayOffense':ao,'homeDefenseAllowed':hd,'homeOffense':ho,'awayDefenseAllowed':ad,'explanation':'Descriptive matchup environment: mean of offense and opposing defense allowed. Season averages, not a calibrated forecast.'})
    # Do not relabel QB hits/sacks as actual tracking pressure.
    vals=[number(a.get('offense',{}).get('pressureRateAllowed')),number(h.get('defense',{}).get('pressureRate')),number(h.get('offense',{}).get('pressureRateAllowed')),number(a.get('defense',{}).get('pressureRate'))]
    if all(v is not None for v in vals):
        ao,hd,ho,ad=vals;gap=((ho+ad)-(ao+hd))/2
        out.append({'name':'Protection versus hit/sack production','side':g['away_abbr'] if gap>0 else g['home_abbr'] if gap<0 else None,'gap':rounded(abs(gap)*100,3),'unit':'percentage points (QB hit/sack proxy; lower allowed is better)','awayOffense':ao,'homeDefenseAllowed':hd,'homeOffense':ho,'awayDefenseAllowed':ad,'explanation':'QB hit/sack proxy, not tracking pressure or pass-block win rate.'})
    return out
def structural_audit(g,c):
    i=c.get('modelInputs',{});keys=['preseasonWeight','liveWeight','awayPreseason','homePreseason','awayLive','homeLive','homeField']
    vals={k:number(i.get(k)) for k in keys};base=number(g.get('model',{}).get('base_structural_home_margin'));adj=number(g.get('model',{}).get('advanced_process_adjustment'));s=number(g.get('model',{}).get('structural_home_margin'))
    if any(v is None for v in vals.values()) or s is None or adj is None:return {'verified':False,'reason':'Missing auditable structural components.'}
    expected=vals['preseasonWeight']*(vals['homePreseason']-vals['awayPreseason'])+vals['liveWeight']*(vals['homeLive']-vals['awayLive'])+vals['homeField']+adj
    ok=abs(expected-s)<=.015 and (base is None or abs(expected-adj-base)<=.015)
    return {'verified':ok,'reason':'Reconciled team priors, prior-week scoring and process adjustment; market excluded from this arithmetic. Structural spread-value comparison still uses market.' if ok else 'Structural component arithmetic failed; disagreement withheld.','reconstructedHomeMargin':rounded(expected,3),'structuralHomeMargin':s if ok else None}
def build_game(g,b,inputs,profiles,now):
    cid=game_key(g);c=row_for(inputs['canonical'],g);m=g.get('model',{});market=g.get('market',{});a,h=g['away_abbr'],g['home_abbr']
    kickoff=date(g.get('kickoff'));started=not kickoff or kickoff<=now or g.get('event_state') in ('final','in','live','post')
    adv=inputs['advanced'];teams={t['abbr']:t for t in adv.get('teams',[])} if current(adv,b) and adv.get('throughWeek')==b['week']-1 else {}
    mech=mechanism_rows(g,teams);ap,hp=profiles.get(a,{}),profiles.get(h,{})
    an=ap.get('season',{}).get('adjustedNetEpa');hn=hp.get('season',{}).get('adjustedNetEpa');gap=hn-an if an is not None and hn is not None else None
    # 0.02 EPA/play is a declared research deadband, not a fitted confidence threshold.
    football=h if gap is not None and gap>.02 else a if gap is not None and gap<-.02 else None
    audit=structural_audit(g,c);s=audit.get('structuralHomeMargin');mh=number(market.get('home_margin'));pf=number(m.get('fair_spread_home_margin'))
    delta=s-mh if s is not None and mh is not None else None
    ats=h if delta is not None and delta>.1 else a if delta is not None and delta<-.1 else None
    inj=row_for(inputs['injuries'],g) if current(inputs['injuries'],b) else {};inactive=row_for(inputs['inactives'],g) if current(inputs['inactives'],b) else {}
    players=inj.get('players',[]);watch=[]
    for p in players:
        status=' '.join(str(p.get(k) or '') for k in ('designation','practice'))
        if any(t in status.lower() for t in ('out','doubtful','questionable','limited','did not')):
            pos=p.get('position','');unit='QB' if pos=='QB' else 'OL' if pos in ('T','G','C','OT','OG') else 'Secondary' if pos in ('CB','S','DB','FS','SS') else 'Other'
            watch.append({'team':p.get('team'),'player':p.get('player'),'position':pos,'status':status.strip(),'unit':unit,'scenario':'If unavailable, reassess protection and the passing matchup.' if unit=='OL' else 'If unavailable, reassess explosive-pass exposure and coverage matchups.' if unit=='Secondary' else 'If unavailable, reassess starter/replacement performance and the game script.' if unit=='QB' else 'Verify role and replacement before execution.'})
    clusters=[]
    for t in (a,h):
        for u in ('QB','OL','Secondary'):
            ps=[x for x in watch if x['team']==t and x['unit']==u]
            if ps:clusters.append({'team':t,'unit':u,'count':len(ps),'players':[x['player'] for x in ps],'note':'Practice/designation watch; starter status and replacement quality not certified.'})
    experts=[]
    for e in inputs['expert'].get('records',[]):
        if game_key(e)!=cid or e.get('week')!=b['week'] or e.get('season')!=b['season']:continue
        ts=e.get('sourceDate') or e.get('source_date') or e.get('timestamp');url=e.get('sourceUrl') or e.get('source_url')
        if not e.get('summary') or not url or not fresh(ts,now,7*24):continue
        experts.append({'family':e.get('sourceFamily') or e.get('source_family'),'analyst':e.get('analyst'),'summary':e['summary'],'sourceUrl':url,'publishedAt':ts,'direction':e.get('direction'),'priceLimit':e.get('price_limit')})
    weather=row_for(inputs['weather'],g) if current(inputs['weather'],b) else {}
    scheme=inputs['style'];offweek=b['week']-1 if current(scheme,b) else None;defweek=scheme.get('sources',{}).get('defenseMotion',{}).get('throughWeek')
    limits=[]
    if not fresh(market.get('timestamp'),now,6):limits.append('Market snapshot older than 6 hours or missing.')
    if not fresh(inj.get('updated_at'),now,48):limits.append('Current game injury report missing or older than 48 hours.')
    if not inactive:limits.append('Official game-day inactives pending.')
    if not experts:limits.append('No attributable current game-specific expert analysis reviewed.')
    if not audit['verified']:limits.append(audit['reason'])
    if not football:limits.append('No clear opponent-adjusted football separation or current sample unavailable.')
    if defweek!=b['week']-1:limits.append(f'Defense versus motion is Week {defweek or "unknown"}; excluded from lean direction.')
    if not ap or not hp:limits.append('Opponent-adjusted and recent-form sample unavailable; no substitute inferred.')
    status='PASS' if not football else 'FOOTBALL LEAN'
    if football and football==ats:status='PRICE WATCH'
    if started:status='STARTED — NOT ISSUED'
    supported=[x for x in mech if x['side']==football];counter=[x for x in mech if x['side'] and x['side']!=football]
    official=next((w for w in inputs['ledger'].get('official_wagers',[]) if game_key(w)==cid or str(w.get('game_id'))==str(g['id'])),None)
    # Only an actual governed wager can carry an actionable badge; no inferred bets.
    if not started and official and all(official.get(k) is not None for k in ('price','stake_units','timestamp','bet')) and (official.get('book') or official.get('source')) and fresh(market.get('timestamp'),now,6) and not limits and date(official.get('timestamp')) and date(official['timestamp'])<kickoff:status='OFFICIAL WAGER'
    side=football;sign=1 if side==h else -1 if side==a else None
    # Static snapshot reference only. Market-aware fair will move when the market moves.
    target=math.ceil((1.5-sign*pf)*2)/2 if sign is not None and pf is not None else None
    return {'gameId':cid,'portalGameId':str(g['id']),'week':b['week'],'away':g['away'],'home':g['home'],'awayAbbr':a,'homeAbbr':h,'kickoff':g.get('kickoff'),'generatedAt':now.isoformat(),'status':status,'footballLean':side if not started else None,'assessmentSide':side,'structuralValueSide':ats,'alignment':'ALIGNED' if side and ats==side else 'CONFLICT' if side and ats else 'UNRESOLVED','thesis':f'{side} has the stronger opponent-adjusted performance profile; inspect the matchup mechanisms and price separately.' if side else 'No clear separation in the current opponent-adjusted performance sample.','mechanisms':supported,'counterarguments':counter,'allMechanisms':mech,'footballGapHome':rounded(gap),'profiles':{a:ap,h:hp},'structuralAudit':audit,'market':market,'productionFair':pf,'structuralFair':s,'structuralDifference':rounded(delta,3),'price':{'side':side,'minimumSpreadAtSnapshot':target,'assumedJuice':-110,'minimumModelPoints':1.5,'status':'ILLUSTRATIVE WATCH REFERENCE — NOT EXECUTABLE','note':'Requires a fresh exact book/line/juice and availability review. Uses the current production fair held fixed; that fair changes with market. No probability, EV or playable-price claim.'},'availability':{'observedAt':inj.get('updated_at'),'reviewComplete':inj.get('reviewComplete',False),'flags':inj.get('flags',[]),'watch':watch,'clusters':clusters,'officialInactives':inactive,'pointAdjustment':0},'weather':weather,'sustainability':{t:{'turnoverRate':teams.get(t,{}).get('offense',{}).get('turnoverRate'),'takeawayRate':teams.get(t,{}).get('defense',{}).get('takeawayRate'),'thirdDownConversion':teams.get(t,{}).get('offense',{}).get('thirdDownRatePbp'),'redZoneTdRate':teams.get(t,{}).get('offense',{}).get('redZoneTdRate')} for t in (a,h)},'experts':experts,'expertFamilies':sorted(set(e['family'] or 'Unknown' for e in experts)),'sourceCoverage':inputs['coverage'].get('summary',{}) if current(inputs['coverage'],b) else {},'scheme':{'offenseThroughWeek':offweek,'defenseThroughWeek':defweek,'excludedFromDirection':True},'limitations':limits,'started':started,'officialWager':official,'researchOnly':True,'productionPointImpact':0}
def grade(snapshot,result):
    r=result.get('result',{});away=number(r.get('awayScore'));home=number(r.get('homeScore'));side=snapshot.get('footballLean');mh=number(snapshot.get('market',{}).get('home_margin'))
    if away is None or home is None or not side:return None
    sign=1 if side==snapshot['homeAbbr'] else -1;margin=sign*(home-away);ats=sign*(home-away-mh) if mh is not None else None
    return {'gameId':snapshot['gameId'],'snapshotAt':snapshot['generatedAt'],'side':side,'alignment':snapshot['alignment'],'winnerResult':'WIN' if margin>0 else 'LOSS' if margin<0 else 'TIE','atsResult':'WIN' if ats is not None and ats>0 else 'LOSS' if ats is not None and ats<0 else 'PUSH' if ats==0 else None,'mechanisms':[x['name'] for x in snapshot['mechanisms']],'closingLineValue':None,'units':None,'note':'Research ATS at saved market line. ROI requires exact issued price/stake; closing line unavailable unless separately captured.'}
def main():
    p=argparse.ArgumentParser();p.add_argument('--data-dir',type=Path,default=ROOT/'data');p.add_argument('--pbp-file',type=Path);p.add_argument('--as-of');p.add_argument('--skip-pbp',action='store_true');args=p.parse_args();data=args.data_dir
    now=date(args.as_of) if args.as_of else datetime.now(timezone.utc);b=read(data,'nfl-weekly-board.json');through=int(b['week'])-1
    profiles={};pbp_status='UNAVAILABLE'
    if not args.skip_pbp:
        try:
            url=f'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{b["season"]}.csv.gz'
            response=open(args.pbp_file,'rb') if args.pbp_file else urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'nfl-team-leans/1.0'}),timeout=50)
            import io
            with response, gzip.open(response,'rt',encoding='utf-8') as fh:profiles=aggregate(csv.DictReader(fh),through)
            pbp_status='CURRENT' if len(profiles)==32 else 'PARTIAL'
        except Exception as e:print('PBP research unavailable:',type(e).__name__,str(e)[:180])
    write(data,'team-lean-performance-current.json',{'season':b['season'],'week':b['week'],'generatedAt':now.isoformat(),'throughWeek':through,'status':pbp_status,'method':'Leave-game-out opponent EPA baselines shrunk with 100 league-average plays; recent = last three calendar weeks. Descriptive only; no fitted spread points or confidence probabilities.','teams':profiles})
    files={'canonical':'weekly-board.json','advanced':'live-team-advanced.json','injuries':'injuries.json','inactives':'official-inactives-current.json','expert':'nfl-expert-weekly.json','weather':'nfl-weather-current.json','style':'nfl-style-matchups.json','coverage':'expert-source-coverage-current.json','ledger':'nfl-bet-ledger.json'}
    inputs={k:read(data,v) for k,v in files.items()};games=[build_game(g,b,inputs,profiles,now) for g in b['games']]
    if len({g['gameId'] for g in games})!=len(games) or any(not g['gameId'] for g in games):raise ValueError('Canonical game IDs missing or duplicated')
    # Persistent append-only observations; skip anything started and do not backfill.
    history=data/'team-lean-snapshots';history.mkdir(exist_ok=True)
    prior_observations=defaultdict(list)
    for path in sorted(history.glob('*.json')):
        old=json.loads(path.read_text());prior_observations[old['gameId']].append(old)
    for g in games:
        old=sorted(prior_observations.get(g['gameId'],[]),key=lambda x:x['generatedAt'])
        g['marketHistory']=[{'observedAt':x['market'].get('timestamp'),'capturedAt':x['generatedAt'],'spread':x['market'].get('spread_display'),'homeMargin':x['market'].get('home_margin'),'source':x['market'].get('source')} for x in ([old[0],old[-1]] if len(old)>1 else old)]
        g['marketHistoryNote']='First/last saved research observations; not verified sportsbook opening or closing prices.'
    added=0
    for g in games:
        if g['started']:continue
        name=f'{g["gameId"]}-{now.strftime("%Y%m%dT%H%M%S")}.json'
        try:
            with (history/name).open('x') as f:json.dump(g,f,indent=2,allow_nan=False)
            added+=1
        except FileExistsError:pass
    # Grade last available authentic pregame assessment across every archived week.
    latest={}
    for path in sorted(history.glob('*.json')):
        s=json.loads(path.read_text());t=date(s.get('generatedAt'));kick=date(s.get('kickoff'))
        if not t or not kick or t>=kick or s.get('started'):continue
        if s['gameId'] not in latest or t>date(latest[s['gameId']]['generatedAt']):latest[s['gameId']]=s
    grades=[]
    for path in (data/'results-clv').glob('*.json'):
        r=json.loads(path.read_text());s=latest.get(r.get('gameId'))
        if s:
            x=grade(s,r)
            if x:grades.append(x)
    ats=[x['atsResult'] for x in grades];summary={'gradedGames':len(grades),'wins':ats.count('WIN'),'losses':ats.count('LOSS'),'pushes':ats.count('PUSH'),'roi':None,'clv':None}
    mechanisms={name:{'games':len(xs:=[g for g in grades if name in g['mechanisms']]),'wins':sum(g['atsResult']=='WIN' for g in xs),'losses':sum(g['atsResult']=='LOSS' for g in xs),'pushes':sum(g['atsResult']=='PUSH' for g in xs)} for name in sorted({n for g in grades for n in g['mechanisms']})}
    performance={'generatedAt':now.isoformat(),'summary':summary,'byMechanism':mechanisms,'games':grades,'rule':'Last authentic pregame observation, including passes in history. Directional leans graded at saved market; never retrospective bets. Overlapping mechanisms are not independent strategies.','ungradedPasses':sum(not s.get('footballLean') for s in latest.values()),'historicalBackfill':False}
    write(data,'team-lean-performance-summary.json',performance)
    out={'schemaVersion':VERSION,'season':b['season'],'week':b['week'],'generatedAt':now.isoformat(),'inputBoardAt':b.get('generated_at'),'throughWeek':through,'researchOnly':True,'productionPointImpact':0,'pbpStatus':pbp_status,'rules':{'direction':'Opponent-adjusted net EPA difference; 0.02 deadband, research heuristic. No sportsbook line in football direction.','evidence':'All EPA/success/explosive splits are one correlated football-performance family; no vote tally.','price':'Watch reference only. Exact book, spread, juice and current availability required; no automatic wager activation.','snapshots':'Append-only before kickoff. No started-game recommendations or historical backfill.','structural':'Component reconciliation verifies this calculation; it does not certify the quality of preseason priors.'},'games':games,'tracking':{'newObservations':added,**summary}}
    write(data,'team-leans-current.json',out)
    print(f'Team leans: {len(games)} games; {sum(not g["started"] for g in games)} pregame; {added} observations; {len(profiles)} PBP teams; {len(grades)} graded.')
if __name__=='__main__':main()
