"""Refresh selected-week official designations without inferring cleared/inactive status."""
import argparse, datetime, html, json, re, urllib.request
from pathlib import Path
from official_inactives import apply_official_inactives

parser = argparse.ArgumentParser()
parser.add_argument('--html', help='Saved official response for reproducible QA')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
read = lambda name: json.loads((root / 'data' / name).read_text())
board = read('weekly-board.json')
season, week = board['season'], board['week']
url = f'https://www.nfl.com/injuries/league/{season}/reg{week}'
if args.html:
    page = Path(args.html).read_text()
else:
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'NFL-portal-availability-QA/1.0'}), timeout=30) as response:
        page = response.read().decode()
now_dt = datetime.datetime.now(datetime.timezone.utc)
def persist_source_limited(reason):
    injuries = read('injuries.json')
    old = {x.get('canonical_game_id', x.get('game_id')): x for x in injuries.get('games', [])}
    due = []
    for game in board['games']:
        if str(game.get('eventState', '')).lower() == 'final':
            continue
        kickoff = datetime.datetime.fromisoformat(game['dateTime'].replace('Z', '+00:00'))
        if kickoff - datetime.timedelta(hours=30) <= now_dt:
            due.append(game['gameId'])
        old[game['gameId']] = dict(
            game_id=game['gameId'],
            canonical_game_id=game['gameId'],
            matchup=f"{game['away']} at {game['home']}",
            reviewComplete=False,
            status='official selected-week table checked; source-limited; final checkpoint pending',
            updated_at=now_dt.isoformat(),
            flags=[],
            players=[],
            sources=[url],
            source_status=reason,
            limitations=['No designation inferred from an unlabeled or unpublished official table.', 'Official final designations and inactives remain mandatory at the pre-kickoff checkpoint.'])
    if due:
        raise SystemExit(f"{reason}; final injury checkpoint due for {', '.join(due)}")
    injuries.update(season=season, week=week, updated_at=now_dt.isoformat(), source_status='CURRENT-SOURCE-LIMITED', games=list(old.values()))
    (root/'data/injuries.json').write_text(json.dumps(injuries, indent=2)+'\n')
    print(f'Official injury source checked for Week {week}; source-limited placeholders persisted for {len(board["games"])} games; no designation inferred')
    raise SystemExit(0)

if not re.search(rf'Injuries\s*-\s*WEEK\s*{week}\b', page, re.I):
    persist_source_limited('Official response does not identify the selected week')
clean = lambda text: ' '.join(html.unescape(re.sub('<[^>]+>', ' ', text)).split())
normalize = lambda code: {'AZ':'ARI', 'WSH':'WAS'}.get(code, code)
by_pair = {}
for section in re.findall(r'<section\b[^>]*class="nfl-o-injury-report__unit"[^>]*>(.*?)</section>', page, re.S):
    codes = [normalize(clean(x)) for x in re.findall(r'<span[^>]*class="nfl-c-matchup-strip__team-abbreviation"[^>]*>(.*?)</span>', section, re.S)]
    tables = re.findall(r'<table\b[^>]*>(.*?)</table>', section, re.S)
    if len(codes) != 2 or len(tables) != 2:
        continue
    players = []
    for code, table in zip(codes, tables):
        for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table, re.S):
            cells = [clean(x) for x in re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S)]
            if len(cells) != 5:
                continue
            name, pos, injury, practice, status = cells
            if status and status.lower() not in ('out', 'doubtful', 'questionable'):
                raise SystemExit(f'Unexpected official designation {status}; preserve existing evidence')
            players.append(dict(team=code, player=name, position=pos, injury=injury or None, practice=practice or None, designation=status or None))
    if players:
        by_pair[tuple(codes)] = players
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
injuries = read('injuries.json')
old = {x.get('canonical_game_id', x.get('game_id')): x for x in injuries.get('games', [])}
updated = 0
for game in board['games']:
    if str(game.get('eventState', '')).lower() == 'final' or datetime.datetime.fromisoformat(game['dateTime'].replace('Z', '+00:00')) <= now_dt:
        continue  # Never rewrite completed-game evidence.
    players = by_pair.get((normalize(game['awayAbbr']), normalize(game['homeAbbr'])))
    if not players:
        continue
    flags = [f"{p['team']} {p['designation'].upper()}: {p['position']} {p['player']} ({p['injury'] or 'injury detail not published'})." for p in players if p['designation']]
    # Monday reports may still be preliminary; a final review is due only inside 30h.
    kickoff = datetime.datetime.fromisoformat(game['dateTime'].replace('Z', '+00:00'))
    final_window = kickoff - datetime.timedelta(hours=30) <= datetime.datetime.now(datetime.timezone.utc)
    complete = final_window and all(any(p['team']==code and p['designation'] for p in players) for code in (normalize(game['awayAbbr']), normalize(game['homeAbbr'])))
    old[game['gameId']] = dict(game_id=game['gameId'], canonical_game_id=game['gameId'], matchup=f"{game['away']} at {game['home']}", reviewComplete=complete, status='official final designation review complete; game-day inactives pending' if complete else 'official practice/designation report reviewed; final checkpoint pending', updated_at=now, flags=flags, players=players, sources=[url], source_status='Official selected-week NFL table; blank designation is not inferred as active/healthy', limitations=['Retrieval timestamp is not the report issuance time.', 'Official inactives must be checked at the pre-kickoff checkpoint.'])
    updated += 1
if not updated:
    raise SystemExit('No unplayed selected-week injury reports parsed; existing evidence preserved')
injuries.update(season=season, week=week, updated_at=now, source_status='OFFICIAL SELECTED-WEEK DESIGNATIONS', games=list(old.values()))
injuries = apply_official_inactives(root, injuries, board, now_dt)
(root/'data/injuries.json').write_text(json.dumps(injuries, indent=2)+'\n')
print(f'Official injury reports refreshed: {updated} unplayed games; historical evidence preserved')
