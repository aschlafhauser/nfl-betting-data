import json, urllib.request, datetime, concurrent.futures, re, argparse
from pathlib import Path
from zoneinfo import ZoneInfo
parser=argparse.ArgumentParser(description='Research official NWS kickoff weather; preserve manually verified London snapshot.')
parser.add_argument('--repo',default=str(Path(__file__).resolve().parents[1]))
parser.add_argument('--output',default=str(Path(__file__).resolve().parents[1]/'data/weather-audit-current.json'))
args=parser.parse_args()

coords={'CHI-GB':(44.5013,-88.0622),'HOU-TEN':(36.1665,-86.7713),'CIN-MIA':(25.9580,-80.2389),'LV-NE':(42.0909,-71.2643),'CLE-NYJ':(40.8135,-74.0745),'IND-PIT':(40.4468,-80.0158),'NYG-WSH':(38.9076,-76.8645),'DEN-LAC':(33.9535,-118.3392),'SF-SEA':(47.5952,-122.3316),'BUF-LAR':(33.9535,-118.3392)}
board=json.load(open(args.repo+'/data/weekly-board.json'))
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'NFL portal weather QA (forecast research)'}),timeout=25) as r:return json.load(r)
def dt(t):return datetime.datetime.fromisoformat(t.replace('Z','+00:00'))
def field_at(values,t):
    for x in values:
        start,dur=x['validTime'].split('/'); end=dt(start)+datetime.timedelta(hours=float(dur.removeprefix('PT').removesuffix('H'))) if dur.startswith('PT') and dur.endswith('H') else None
        if end and dt(start)<=t<end:return x['value']
    return None
def fetch(g):
    pair=g['gameId'].split('-',2)[-1]; lat,lon=coords[pair]; t=dt(g['dateTime']); u=f'https://api.weather.gov/points/{lat},{lon}'
    rec={'game_id':g['gameId'],'kickoff':g['dateTime'],'temp_f':None,'wind_mph':None,'gust_mph':None,'precip_chance_pct':None,'forecast_timestamp':None,'sources':[u]}
    try:
        p=get(u)['properties']; hu=p['forecastHourly']; rec['sources'].append(hu); f=get(hu)['properties']
        rec['forecast_timestamp']=f.get('updated') or f.get('updateTime') or f.get('generatedAt')
        period=next((q for q in f.get('periods',[]) if dt(q['startTime'])<=t<dt(q['endTime'])),None)
        if not period:
            rec['verification_status']='unavailable: official hourly feed does not cover target kickoff';rec['feed_valid_range']=[f.get('periods',[{}])[0].get('startTime'),f.get('periods',[{}])[-1].get('endTime')]; return rec
        speed=period['windSpeed']; nums=re.findall(r'\d+(?:\.\d+)?',speed)
        rec.update(temp_f=period['temperature'] if period['temperatureUnit']=='F' else round(period['temperature']*9/5+32,1),wind_mph=float(nums[0]) if len(nums)==1 else None,wind_speed_raw=speed,wind_direction=period['windDirection'],precip_chance_pct=period.get('probabilityOfPrecipitation',{}).get('value'),forecast_hour_start=period['startTime'],forecast_hour_end=period['endTime'],conditions=period.get('shortForecast'),verification_status='verified official NWS kickoff-containing hourly forecast')
        try:
            gu=p['forecastGridData']; grid=get(gu)['properties']; rec['sources'].append(gu); gust=field_at(grid.get('windGust',{}).get('values',[]),t)
            if gust is not None:rec['gust_mph']=round(gust*0.621371,1) if grid['windGust'].get('uom')=='wmoUnit:km_h-1' else gust
            rec['gust_unit_original']=grid.get('windGust',{}).get('uom')
        except Exception as e:rec['gust_limitation']=str(e)
        if pair in ('DEN-LAC','BUF-LAR'):rec['venue_limitation']='SoFi is covered/open-sided; surrounding point forecast is not on-field wind or rain exposure. No automatic weather model adjustment.'
    except Exception as e:rec['verification_status']='unavailable: '+str(e)
    return rec
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:rows=list(pool.map(fetch,[g for g in board['games'] if g['gameId'].split('-',2)[-1] in coords]))
try:previous=json.load(open(args.output))
except (OSError,ValueError):previous={}
if board['season']==2026 and board['week']==5:
    london=next((g for g in previous.get('games',[]) if g['game_id']=='2026-W5-PHI-JAX'),None)
    if not london:
        london={'game_id':'2026-W5-PHI-JAX','kickoff':'2026-10-11T13:30Z','temp_f':59,'wind_mph':2,'gust_mph':9,'precip_chance_pct':None,'precip_chance_upper_bound_pct':5,'precip_chance_display':'<5%','forecast_timestamp':None,'retrieved_at':'2026-10-11T12:46:42+00:00','forecast_hour_start':'2026-10-11T14:00:00+01:00','forecast_hour_end':'2026-10-11T15:00:00+01:00','conditions':'Sunny intervals','wind_direction':'W','verification_status':'verified official Met Office current Sunday Oct 11 hourly table; manual snapshot','sources':['https://weather.metoffice.gov.uk/forecast/gcpvwd6uv?nearestTo=Tottenham+(Haringey)'],'limitations':['Met Office issuance timestamp not exposed; retrieved_at is retrieval time, not issue time.','14:30 BST kickoff bracketed by 14:00 and 15:00 forecasts; both 15 C, wind 2 mph, gust 9 mph, precipitation <5%.','Manual London snapshot is not automatically refreshed by this script.']}
    rows.append(london)
venue_data=json.load(open(args.repo+'/data/nfl-weather-current.json'))
for g in board['games']:
    if g.get('eventState')=='final':continue
    venue=next((v for v in venue_data['games'] if v['game_id']==g['gameId']),{})
    if venue.get('environment')=='indoor':rows.append({'game_id':g['gameId'],'kickoff':g['dateTime'],'temp_f':None,'wind_mph':None,'gust_mph':None,'precip_chance_pct':None,'forecast_timestamp':None,'verification_status':'indoor venue; outdoor weather forecast not applicable','venue':venue.get('venue'),'sources':[venue.get('source')],'limitations':['Roof status is governed by venue/event information; outside air values are not on-field conditions.']})
    for row in rows:
        if row['game_id']==g['gameId']:row.setdefault('retrieved_at',datetime.datetime.now(datetime.timezone.utc).isoformat())
out={'season':board['season'],'week':board['week'],'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'games':rows}
json.dump(out,open(args.output,'w'),indent=2)

by={r['game_id']:r for r in rows}
for w in venue_data['games']:
    r=by.get(w['game_id'])
    if not r or not r['verification_status'].startswith(('verified','indoor')):continue
    indoor=r['verification_status'].startswith('indoor')
    precipitation=r.get('precip_chance_display',str(r.get('precip_chance_pct'))+'%')
    w.update(status='Official indoor venue verified' if indoor else 'Official kickoff-hour forecast verified',observed_at=r['retrieved_at'],forecast_timestamp=r.get('forecast_timestamp'),forecast_verified=True,forecast=r,sources=r['sources'],source=r['sources'][0])
    if not indoor:
        w['summary']=f"{r.get('conditions','')} at kickoff: {r.get('temp_f')}°F; wind {r.get('wind_direction','')} {r.get('wind_mph')} mph, gust {r.get('gust_mph')} mph; precipitation chance {precipitation}."
        if r.get('venue_limitation'):w['summary']+=' '+r['venue_limitation']
        w['risk']='weather review required' if (r.get('gust_mph') or 0)>=20 or (r.get('precip_chance_pct') or 0)>=40 else 'no major hourly weather flag'
    else:w['risk']='indoor / roof controlled'
venue_data['updated_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();venue_data['source_status']='Official NWS kickoff-hour forecasts and verified Met Office London snapshot'
json.dump(venue_data,open(args.repo+'/data/nfl-weather-current.json','w'),indent=2)
print('Official weather coverage',len(rows),'games')

