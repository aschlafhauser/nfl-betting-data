#!/usr/bin/env python3
"""Observed pregame player usage; unavailable tracking metrics remain absent."""
import csv
from collections import defaultdict
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('advanced',Path(__file__).with_name('enrich-advanced-team-stats.py'));advanced=importlib.util.module_from_spec(spec);spec.loader.exec_module(advanced)
open_pbp,n,load,save,mean,PBP_URL=(getattr(advanced,k) for k in ['open_pbp','n','load','save','mean','PBP_URL'])

board=load('weekly-board.json'); through=int(board['week'])-1
players={}; team_targets=defaultdict(int); team_rushes=defaultdict(int)
def player(row, role):
    pid=row.get(role+'_player_id'); name=row.get(role+'_player_name')
    if not pid or not name:return None
    team={'WAS':'WSH','LA':'LAR'}.get(row.get('posteam'),row.get('posteam'))
    key=pid+'-'+team
    if key not in players:players[key]={'id':pid,'name':name,'team':team,'games':set(),'passing':defaultdict(float),'rushing':defaultdict(float),'receiving':defaultdict(float),'dropbackEpas':[],'rushEpas':[],'receiveEpas':[],'cpoes':[]}
    p=players[key];p['games'].add(row['game_id']);return p

with open_pbp(None) as fh:
    for r in csv.DictReader(fh):
        if r.get('season_type')!='REG' or not 1<=n(r.get('week'))<=through or n(r.get('no_play'))==1:continue
        team={'WAS':'WSH','LA':'LAR'}.get(r.get('posteam'),r.get('posteam'))
        passer=player(r,'passer');rusher=player(r,'rusher');receiver=player(r,'receiver')
        epa=n(r.get('epa'),None)
        if passer and n(r.get('qb_dropback'))==1:
            p=passer['passing'];p['dropbacks']+=1;p['attempts']+=n(r.get('pass_attempt'))*(1-n(r.get('sack')));p['completions']+=n(r.get('complete_pass'));p['yards']+=n(r.get('passing_yards'));p['touchdowns']+=n(r.get('pass_touchdown'));p['interceptions']+=n(r.get('interception'));p['sacks']+=n(r.get('sack'))
            if epa is not None:passer['dropbackEpas'].append(epa)
            cpoe=n(r.get('cpoe'),None)
            if cpoe is not None:passer['cpoes'].append(cpoe)
        if rusher and n(r.get('rush_attempt'))==1 and n(r.get('qb_kneel'))!=1:
            team_rushes[team]+=1;p=rusher['rushing'];p['attempts']+=1;p['yards']+=n(r.get('rushing_yards'));p['touchdowns']+=n(r.get('rush_touchdown'))
            if epa is not None:rusher['rushEpas'].append(epa)
        if receiver and n(r.get('pass_attempt'))==1:
            team_targets[team]+=1;p=receiver['receiving'];p['targets']+=1;p['receptions']+=n(r.get('complete_pass'));p['yards']+=n(r.get('receiving_yards'));p['touchdowns']+=n(r.get('pass_touchdown'));p['airYards']+=n(r.get('air_yards'))
            if epa is not None:receiver['receiveEpas'].append(epa)

rows=[]
for p in players.values():
    p['games']=len(p['games']);p['passing']=dict(p['passing']);p['rushing']=dict(p['rushing']);p['receiving']=dict(p['receiving'])
    p['epaPerDropback']=mean(p.pop('dropbackEpas'));p['rushEpa']=mean(p.pop('rushEpas'));p['receivingEpa']=mean(p.pop('receiveEpas'));p['cpoe']=mean(p.pop('cpoes'))
    p['targetShare']=p['receiving'].get('targets',0)/team_targets[p['team']] if team_targets[p['team']] else None
    p['rushShare']=p['rushing'].get('attempts',0)/team_rushes[p['team']] if team_rushes[p['team']] else None
    rows.append(p)
if len({p['team'] for p in rows})!=32:raise ValueError('Incomplete observed player team coverage')
old=load('live-player-stats.json');now=datetime.now(timezone.utc).isoformat()
save('live-player-stats.json',{**old,'season':board['season'],'week':board['week'],'throughWeek':through,'updatedAt':now,'source':{'primary':PBP_URL,'status':'observed completed regular-season plays through pregame cutoff'},'coverage':{'teams':32,'players':len(rows),'trackingMetrics':'Routes, snaps, tracking pressure and yards after contact remain unavailable; no proxies manufactured.'},'players':rows})
print('Observed player profiles:',len(rows),'through Week',through)
