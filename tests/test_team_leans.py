import copy, importlib.util, json, tempfile, unittest
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('leans',ROOT/'scripts/build-team-leans.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TeamLeansTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime(2026,10,23,18,tzinfo=timezone.utc)
  self.b={'season':2026,'week':7}
  self.g={'id':'1','canonical_game_id':'2026-W7-A-H','away':'Away','home':'Home','away_abbr':'A','home_abbr':'H','kickoff':'2026-10-25T17:00Z','market':{'home_margin':3,'timestamp':'2026-10-23T17:00Z'},'model':{'structural_home_margin':5,'base_structural_home_margin':5,'advanced_process_adjustment':0,'fair_spread_home_margin':3.4}}
  self.i={k:{} for k in ('canonical','advanced','injuries','inactives','expert','weather','style','coverage','ledger')}
  self.i['canonical']={'games':[{'gameId':'2026-W7-A-H','modelInputs':{'preseasonWeight':1,'liveWeight':0,'awayPreseason':0,'homePreseason':4,'awayLive':0,'homeLive':0,'homeField':1}}]}
  self.profiles={'A':{'season':{'adjustedNetEpa':0}},'H':{'season':{'adjustedNetEpa':.1}}}
 def build(self):return m.build_game(self.g,self.b,self.i,self.profiles,self.now)
 def test_null_is_missing_zero_is_real(self):
  self.assertIsNone(m.number(None));self.assertIsNone(m.number(''));self.assertEqual(m.number(0),0)
  self.g['model']['structural_home_margin']=None;self.assertIsNone(self.build()['structuralFair'])
 def test_market_does_not_change_football_direction(self):
  before=self.build();self.g['market']['home_margin']=10;after=self.build()
  self.assertEqual(before['footballLean'],after['footballLean']);self.assertEqual(before['alignment'],'ALIGNED');self.assertEqual(after['alignment'],'CONFLICT');self.assertEqual(after['structuralValueSide'],'A')
 def test_structural_market_contamination_rejected(self):
  self.g['model']['structural_home_margin']=8;self.assertFalse(self.build()['structuralAudit']['verified']);self.assertIsNone(self.build()['structuralValueSide'])
 def test_just_started_and_final_never_issued(self):
  self.g['kickoff']=self.now.isoformat();r=self.build();self.assertTrue(r['started']);self.assertIsNone(r['footballLean']);self.assertEqual(r['status'],'STARTED — NOT ISSUED')
 def test_wrong_week_injuries_and_experts_excluded(self):
  self.i['injuries']={'season':2026,'week':6,'games':[{'gameId':self.g['canonical_game_id'],'flags':['OLD FLAG']}]}
  self.i['expert']={'records':[{'gameId':self.g['canonical_game_id'],'season':2026,'week':6,'summary':'OLD PICK','sourceUrl':'https://example.com','sourceDate':'2026-10-23'}]}
  r=self.build();self.assertEqual(r['availability']['flags'],[]);self.assertEqual(r['experts'],[])
 def test_threshold_home_and_away_sign(self):
  self.assertEqual(self.build()['price']['minimumSpreadAtSnapshot'],-1.5)
  self.profiles['A']['season']['adjustedNetEpa']=.2
  self.assertEqual(self.build()['price']['minimumSpreadAtSnapshot'],5)
 def test_international_venue_rejects_us_forecast(self):
  self.i['weather']={**self.b,'games':[{'gameId':self.g['canonical_game_id'],'venue':'Stade de France','source':'https://api.weather.gov/points/29.9,-90.1','summary':'Sunny in New Orleans'}]}
  r=self.build();self.assertFalse(r['weather']['forecast_verified']);self.assertNotIn('Sunny',r['weather']['summary'])
 def test_no_official_bet_inferred(self):
  r=self.build();self.assertIn(r['status'],('PRICE WATCH','FOOTBALL LEAN','PASS'));self.assertTrue(r['researchOnly']);self.assertEqual(r['productionPointImpact'],0)
 def test_ats_grading_both_sides_push(self):
  s=self.build();res={'result':{'awayScore':20,'homeScore':23}};self.assertEqual(m.grade(s,res)['atsResult'],'PUSH')
  res['result']['homeScore']=24;self.assertEqual(m.grade(s,res)['atsResult'],'WIN')
  s['footballLean']='A';self.assertEqual(m.grade(s,res)['atsResult'],'LOSS');self.assertIsNone(m.grade(s,res)['units'])
 def test_pbp_future_week_excluded(self):
  base={'season_type':'REG','week':'6','play_type':'pass','posteam':'A','defteam':'H','epa':'1','game_id':'g','down':'1','qb_dropback':'1'}
  rows=[base,{**base,'posteam':'H','defteam':'A','epa':'0'}]
  before=m.aggregate(rows,6);after=m.aggregate(rows+[{**base,'week':'7','epa':'999'}],6);self.assertEqual(before,after)
 def test_inputs_unchanged(self):
  original=copy.deepcopy((self.g,self.i));self.build();self.assertEqual(original,(self.g,self.i))
 def test_append_only_and_no_postkickoff_backfill(self):
  import subprocess
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp); (d/'nfl-weekly-board.json').write_text(json.dumps({**self.b,'games':[self.g]}))
   for k,name in {'canonical':'weekly-board','advanced':'live-team-advanced','injuries':'injuries','inactives':'official-inactives-current','expert':'nfl-expert-weekly','weather':'nfl-weather-current','style':'nfl-style-matchups','coverage':'expert-source-coverage-current','ledger':'nfl-bet-ledger'}.items():
    (d/(name+'.json')).write_text(json.dumps(self.i[k]))
   protected=(d/'nfl-weekly-board.json').read_bytes()
   cmd=['python',str(ROOT/'scripts/build-team-leans.py'),'--data-dir',tmp,'--skip-pbp','--as-of',self.now.isoformat()]
   subprocess.run(cmd,check=True,capture_output=True); files=list((d/'team-lean-snapshots').glob('*.json'));self.assertEqual(len(files),1);old=files[0].read_bytes()
   subprocess.run(cmd,check=True,capture_output=True);self.assertEqual(len(list((d/'team-lean-snapshots').glob('*.json'))),1);self.assertEqual(files[0].read_bytes(),old)
   cmd[-1]='2026-10-26T00:00:00Z';subprocess.run(cmd,check=True,capture_output=True)
   self.assertEqual(len(list((d/'team-lean-snapshots').glob('*.json'))),1);self.assertEqual((d/'nfl-weekly-board.json').read_bytes(),protected)
 def test_current_runtime_contract(self):
  p=ROOT/'data/team-leans-current.json'
  if not p.exists():self.skipTest('Generated artifact not present')
  d=json.loads(p.read_text());b=json.loads((ROOT/'data/nfl-weekly-board.json').read_text())
  if (d['season'],d['week'])!=(b['season'],b['week']):self.skipTest('Previous artifact pending weekly rebuild')
  self.assertEqual({g['gameId'] for g in d['games']},{g['canonical_game_id'] for g in b['games']});self.assertEqual(d['productionPointImpact'],0)
  for g in d['games']:
   if g['started']:self.assertIsNone(g['footballLean'])
   self.assertNotEqual(g['status'],'OFFICIAL WAGER') if not g['officialWager'] else None
if __name__=='__main__':unittest.main()
