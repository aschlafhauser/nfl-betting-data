# NFL Betting Data

Public runtime-data repository for the 2026 NFL Betting Intelligence portal.

The private application/model lives in `aschlafhauser/nfl-betting-intelligence`. This repository exists so frequently changing season data can update without triggering an application deployment.

## Runtime datasets

- `data/weekly-board.json`
- `data/markets.json`
- `data/injuries.json`
- `data/game-intelligence.json`
- `data/live-team-stats.json`
- `data/live-player-stats.json`
- `data/player-values.json`
- `data/power-ratings.json`
- `data/expert-weekly.json`
- `data/expert-source-audit.json`
- `data/results-2026.json`
- `data/model-snapshots.json`
- `data/bet-recommendations.json`

## Operating principle

Routine updates to markets, injuries, team/player stats, expert intelligence, results and model snapshots belong here. Application code, rendering logic and model implementation belong in the private application repository.
