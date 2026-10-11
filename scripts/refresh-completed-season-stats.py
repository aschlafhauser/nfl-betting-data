#!/usr/bin/env python3
"""Publish observed season-to-date box-score stats through the pregame cutoff.

Advanced metrics/model coefficients are preserved. Defensive totals come from
opponents' box scores in each team's games, never the latest opponent's season.
"""
import json, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / 'data'
def get(url):
    with urllib.request.urlopen(url, timeout=45) as r:
        return json.load(r)
def read(name): return json.loads((DATA / name).read_text())
def write(name, d): (DATA / name).write_text(json.dumps(d, separators=(',', ':'))+'\n')
def abbr(s): return {'LA':'LAR','WAS':'WSH'}.get(s,s)
board=read('weekly-board.json'); season=int(board['season']); through=int(board['week'])-1
urls=[f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={season}&seasontype=2&week={w}&limit=100' for w in range(1,through+1)]
with ThreadPoolExecutor(max_workers=8) as pool:
    scoreboards=list(pool.map(get,urls))
events={e['id']:e for b in scoreboards for e in b.get('events',[]) if e.get('status',{}).get('type',{}).get('completed')}
def summary(event):
    return get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event='+event)
with ThreadPoolExecutor(max_workers=8) as pool:
    summaries=list(pool.map(summary,events))
bags=defaultdict(list)
for e,j in zip(events.values(),summaries):
    competitors=e['competitions'][0]['competitors']; scores={abbr(c['team']['abbreviation']):float(c['score']) for c in competitors}
    teams=j.get('boxscore',{}).get('teams',[])
    if len(teams)!=2: raise ValueError('Missing two-team box score '+e['id'])
    parsed=[]
    for t in teams:
        stats={s['name']:s.get('displayValue') for s in t.get('statistics',[])}
        def number(k):
            v=stats.get(k)
            return float(v) if v not in (None,'','--') else None
        def fraction(k):
            v=stats.get(k,'0-0').split('-')
            return [float(x) for x in v] if len(v)==2 else [0,0]
        parsed.append((abbr(t['team']['abbreviation']),{'yards':number('totalYards'),'passYards':number('netPassingYards'),'rushYards':number('rushingYards'),'plays':number('totalOffensivePlays'),'rushAttempts':number('rushingAttempts'),'third':fraction('thirdDownEff'),'redzone':fraction('redZoneAttempts')}))
    for (a,o),(b,d) in [parsed,parsed[::-1]]:
        if any(o[k] is None or d[k] is None for k in ['yards','passYards','rushYards','plays']): raise ValueError('Incomplete box score '+e['id'])
        bags[a].append({'off':o,'def':d,'pf':scores[a],'pa':scores[b],'eventId':e['id']})
stats=read('live-team-stats.json'); now=datetime.now(timezone.utc).isoformat()
for t in stats['teams']:
    rows=bags[abbr(t['abbr'])]; count=len(rows)
    if not count: raise ValueError('No completed season sample '+t['abbr'])
    avg=lambda side,key:sum(x[side][key] for x in rows)/count
    ratio=lambda side,key:sum(x[side][key][0] for x in rows)/sum(x[side][key][1] for x in rows) if sum(x[side][key][1] for x in rows) else None
    t['recentFormGames']=t.get('games'); t['recentFormPointsFor']=t.get('pointsForPerGame'); t['recentFormPointsAgainst']=t.get('pointsAgainstPerGame')
    t['games']=count; t['pointsForPerGame']=sum(x['pf'] for x in rows)/count; t['pointsAgainstPerGame']=sum(x['pa'] for x in rows)/count
    t['offense'].update(pointsPerGame=t['pointsForPerGame'],yardsPerGame=avg('off','yards'),passingYardsPerGame=avg('off','passYards'),rushingYardsPerGame=avg('off','rushYards'),yardsPerPlay=sum(x['off']['yards'] for x in rows)/sum(x['off']['plays'] for x in rows),yardsPerRush=sum(x['off']['rushYards'] for x in rows)/sum(x['off']['rushAttempts'] for x in rows),thirdDownRate=ratio('off','third'),redZoneTdRate=ratio('off','redzone'))
    t['defense'].update(pointsAllowedPerGame=t['pointsAgainstPerGame'],yardsAllowedPerGame=avg('def','yards'),passingYardsAllowedPerGame=avg('def','passYards'),rushingYardsAllowedPerGame=avg('def','rushYards'),thirdDownRateAllowed=ratio('def','third'),redZoneTdRateAllowed=ratio('def','redzone'))
    t['context'].update(games=count,throughWeek=through,standardStatsSource='ESPN completed game box scores',standardStatsGameIds=[x['eventId'] for x in rows],standardStatsUpdatedAt=now)
    t['observedAt']=now
stats['standardStatsUpdatedAt']=now; stats['standardStatsThroughWeek']=through
write('live-team-stats.json',stats)
advanced=read('live-team-advanced.json')
by={t['abbr']:t for t in stats['teams']}
for t in advanced['teams']:
    source=by[t['abbr']];t['games']=source['games'];t['context'].update(games=source['games'])
    for side,keys in [('offense',['pointsPerGame','yardsPerGame','passingYardsPerGame','rushingYardsPerGame','yardsPerPlay','thirdDownRate','redZoneTdRate']),('defense',['pointsAllowedPerGame','yardsAllowedPerGame','passingYardsAllowedPerGame','rushingYardsAllowedPerGame','thirdDownRateAllowed','redZoneTdRateAllowed'])]:
        for k in keys:t[side][k]=source[side][k]
advanced['standardStatsUpdatedAt']=now;write('live-team-advanced.json',advanced)
audit={'season':season,'week':board['week'],'verifiedAt':now,'status':'PASS','teamCount':len(stats['teams']),'throughWeek':through,'completedGames':len(events),'detail':f'32 observed season-to-date profiles through Week {through}; defensive yardage independently aggregated from each opponent box score. Advanced inputs use the same pregame cutoff.','failures':[]}
write(f'statistical-display-integrity-{season}-w{board["week"]}.json',audit)
print(json.dumps({'teams':len(stats['teams']),'completedGames':len(events),'throughWeek':through,'sampleCounts':sorted(set(t['games'] for t in stats['teams']))}))
