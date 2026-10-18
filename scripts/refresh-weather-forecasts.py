import json, urllib.request, datetime, concurrent.futures, re, argparse
from pathlib import Path
from zoneinfo import ZoneInfo
parser=argparse.ArgumentParser(description='Refresh official kickoff-hour forecasts for domestic and supported international venues.')
parser.add_argument('--repo',default=str(Path(__file__).resolve().parents[1]))
parser.add_argument('--output',default=str(Path(__file__).resolve().parents[1]/'data/weather-audit-current.json'))
args=parser.parse_args()

coords={'GB':(44.5013,-88.0622),'NE':(42.0909,-71.2643),'NYG':(40.8135,-74.0745),'NYJ':(40.8135,-74.0745),'CLE':(41.5061,-81.6995),'PHI':(39.9008,-75.1675),'TB':(27.9759,-82.5033),'KC':(39.0489,-94.4839),'SF':(37.403,-121.970),'LAR':(33.9535,-118.3392),'LAC':(33.9535,-118.3392),'DEN':(39.7439,-105.0201),'SEA':(47.5952,-122.3316),'TEN':(36.1665,-86.7713),'ARI':(33.5276,-112.2626),'ATL':(33.7554,-84.4008),'BAL':(39.278,-76.6227),'BUF':(42.774,-78.787),'CAR':(35.2258,-80.8528),'CHI':(41.8623,-87.6167),'CIN':(39.0954,-84.516),'DAL':(32.7473,-97.0945),'DET':(42.340,-83.0456),'HOU':(29.6847,-95.4107),'IND':(39.7601,-86.1639),'JAX':(30.3239,-81.6373),'LV':(36.09,-115.183),'MIA':(25.958,-80.2389),'MIN':(44.9738,-93.2578),'NO':(29.9511,-90.0812),'PIT':(40.4468,-80.0158),'WAS':(38.9076,-76.8645),'WSH':(38.9076,-76.8645)}
board=json.load(open(args.repo+'/data/weekly-board.json'))
venue_data=json.load(open(args.repo+'/data/nfl-weather-current.json'))
venue_by_id={v['game_id']:v for v in venue_data['games']}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'NFL portal weather QA (forecast research)'}),timeout=25) as r:return json.load(r)
def dt(t):return datetime.datetime.fromisoformat(t.replace('Z','+00:00'))
def field_at(values,t):
    for x in values:
        start,dur=x['validTime'].split('/'); end=dt(start)+datetime.timedelta(hours=float(dur.removeprefix('PT').removesuffix('H'))) if dur.startswith('PT') and dur.endswith('H') else None
        if end and dt(start)<=t<end:return x['value']
    return None
def fetch(g):
    pair=g['gameId'].split('-',2)[-1]; lat,lon=coords[g['homeAbbr']]; t=dt(g['dateTime']); u=f'https://api.weather.gov/points/{lat},{lon}'
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
        if g['homeAbbr'] in ('LAC','LAR'):rec['venue_limitation']='SoFi is covered/open-sided; surrounding point forecast is not on-field wind or rain exposure. No automatic weather model adjustment.'
    except Exception as e:rec['verification_status']='unavailable: '+str(e)
    return rec
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:rows=list(pool.map(fetch,[g for g in board['games'] if g.get('homeAbbr') in coords and g.get('eventState')!='final' and not any(k in str(venue_by_id.get(g['gameId'],{}).get('venue','')).lower() for k in ('wembley','tottenham','berlin','munich','madrid','melbourne','mexico','sao paulo','dublin','paris'))]))
try:previous=json.load(open(args.output))
except (OSError,ValueError):previous={}
# Preserve only fresh selected-week international forecasts reviewed separately.
for prior in previous.get('games',[]):
    if prior.get('game_id') in {g['gameId'] for g in board['games']} and prior.get('manual_international') and (datetime.datetime.now(datetime.timezone.utc)-dt(prior.get('retrieved_at','2000-01-01T00:00:00Z'))).total_seconds()<12*3600:rows.append(prior)
# International venue mapping is explicit; never use the nominal home city's weather.
for game in board['games']:
    if game.get('eventState')=='final':continue
    venue=next((v for v in json.load(open(args.repo+'/data/nfl-weather-current.json'))['games'] if v['game_id']==game['gameId']),{})
    if 'wembley' not in str(venue.get('venue','')).lower():continue
    u='https://weather.metoffice.gov.uk/forecast/gcpv39krt'
    try:
        with urllib.request.urlopen(u,timeout=25) as response:page=response.read().decode()
        local=dt(game['dateTime']).astimezone(ZoneInfo('Europe/London'));date=local.date().isoformat()
        table=re.search(r'<table[^>]*data-date="'+date+r'"[^>]*>(.*?)</table>',page,re.S).group(1)
        clean=lambda x:re.sub(r'<[^>]+>',' ',x).strip()
        trs=re.findall(r'<tr[^>]*>(.*?)</tr>',table,re.S)
        cells=lambda row:re.findall(r'<td[^>]*>(.*?)</td>',row,re.S)
        times=[clean(c) for c in cells(trs[0])];hour=local.hour%12 or 12;label=str(hour)+('pm' if local.hour>=12 else 'am');ix=times.index(label)
        number=lambda x:float(re.search(r'-?\d+(?:\.\d+)?',clean(x)).group())
        temp=cells(trs[1])[ix];condition=re.search(r'alt="([^"]+)"',temp).group(1)
        precip=number(cells(trs[3])[ix]);wind=number(cells(trs[4])[ix]);gust=number(cells(trs[5])[ix])
        rows=[r for r in rows if r['game_id']!=game['gameId']]
        rows.append({'game_id':game['gameId'],'kickoff':game['dateTime'],'temp_f':round(number(temp)*9/5+32,1),'wind_mph':wind,'gust_mph':gust,'precip_chance_pct':precip,'forecast_timestamp':None,'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'forecast_hour_start':local.replace(minute=0,second=0).isoformat(),'forecast_hour_end':(local.replace(minute=0,second=0)+datetime.timedelta(hours=1)).isoformat(),'conditions':condition,'verification_status':'verified official Met Office kickoff-containing hourly forecast','sources':[u],'limitations':['Hourly forecast is not an on-field observation. Issuance time unavailable; retrieved_at records retrieval.']})
    except Exception as e:rows.append({'game_id':game['gameId'],'verification_status':'unavailable: international forecast '+str(e),'sources':[u]})
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

