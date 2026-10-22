"""Overlay observed official game-day announcements on preliminary designations."""
import datetime
import json
from urllib.parse import urlparse

def apply_official_inactives(root, injuries, board, now):
    path = root / 'data' / 'official-inactives-current.json'
    if not path.exists():
        return injuries
    data = json.loads(path.read_text())
    if (data.get('season'), data.get('week')) != (board['season'], board['week']):
        return injuries
    games = {g['gameId']: g for g in board['games']}
    evidence = {g['gameId']: g for g in data.get('games', [])}
    for row in injuries['games']:
        gid = row.get('canonical_game_id', row.get('game_id'))
        g, e = games.get(gid), evidence.get(gid)
        if not g or not e or str(g.get('eventState', '')).lower() == 'final':
            continue
        kickoff = datetime.datetime.fromisoformat(g['dateTime'].replace('Z', '+00:00'))
        published = datetime.datetime.fromisoformat(e['publishedAt'].replace('Z', '+00:00'))
        observed = datetime.datetime.fromisoformat(e['observedAt'].replace('Z', '+00:00'))
        assert kickoff - datetime.timedelta(hours=6) <= published <= observed <= kickoff
        assert all(urlparse(u).hostname in ('www.patriots.com', 'www.chicagobears.com') for u in e['sources'])
        inactive = {(p['team'], p['player']) for p in e['inactive']}
        active = {(p['team'], p['player']) for p in e['confirmedActive']}
        assert not inactive.intersection(active)
        players = {(p['team'], p['player']): dict(p) for p in row.get('players', [])}
        for status, values in [('Inactive', e['inactive']), ('Active', e['confirmedActive']), ('Injured Reserve', e.get('injuredReserve', []))]:
            for p in values:
                key = (p['team'], p['player'])
                player = players.setdefault(key, dict(p))
                player['practiceDesignation'] = player.get('practiceDesignation', player.get('designation'))
                player['designation'] = status
                player['gameDayStatus'] = status
        flags = [f"{p['team']} INACTIVE: {p['position']} {p['player']}." for p in e['inactive']]
        flags += [f"{p['team']} INJURED RESERVE: {p['position']} {p['player']}." for p in e.get('injuredReserve', [])]
        flags += [f"{p['team']} ACTIVE (officially confirmed; does not imply full health): {p['position']} {p['player']}." for p in e['confirmedActive']]
        row.update(players=list(players.values()), flags=flags, reviewComplete=True, inactivesVerified=True,
                   status='official game-day inactives and named active statuses verified',
                   updated_at=e['observedAt'], source_date=e['publishedAt'],
                   sources=list(dict.fromkeys(row.get('sources', []) + e['sources'])),
                   source_status='OFFICIAL GAME-DAY ANNOUNCEMENT',
                   limitations=['Active status does not imply full health or unrestricted snaps.', 'No automatic injury point adjustment.'])
    return injuries
