#!/usr/bin/env python3
"""Enrich the NFL runtime with leakage-safe nflverse process metrics.

For target Week N, only regular-season plays through Week N-1 are used.  The
advanced process layer is deliberately conservative: it replaces 40% of the
existing live scoring-margin signal, and the complete live layer remains phase
weighted.  Motion is a separately capped matchup term because the current
defensive source is categorical and early-season.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import statistics
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz"
ABBR = {"LA": "LAR", "WSH": "WAS"}
PROFILE = {"very-weak": 2.0, "weak": 1.0, "neutral": 0.0, "strong": -1.0, "very-strong": -2.0}
COMPOSITE = {
    "netEpa": .20,
    "netSuccess": .15,
    "netEarlyDownEpa": .10,
    "netDropbackEpa": .15,
    "netRushEpa": .10,
    "netExplosiveRate": .10,
    "netPressureRate": .10,
    "netSituationalRate": .10,
}
ADV_OFF = ("plays", "epaPerPlay", "successRate", "earlyDownEpa", "earlyDownSuccessRate", "dropbackEpa", "dropbackSuccessRate", "rushEpa", "rushSuccessRate", "explosivePlayRate", "pressureRateAllowed", "sackRateAllowed", "turnoverRate", "neutralPassRate", "thirdDownRatePbp", "redZoneSuccessRate", "stuffRateAllowed", "motionRate", "playActionRate", "shotgunRate", "noHuddleRate", "airYardsPerAttempt")
ADV_DEF = ("plays", "epaAllowedPerPlay", "successRateAllowed", "earlyDownEpaAllowed", "earlyDownSuccessRateAllowed", "dropbackEpaAllowed", "dropbackSuccessRateAllowed", "rushEpaAllowed", "rushSuccessRateAllowed", "explosivePlayRateAllowed", "pressureRate", "sackRate", "takeawayRate", "thirdDownRateAllowedPbp", "redZoneSuccessRateAllowed", "stuffRate", "motionPassProfile", "motionRunProfile", "motionNumericEpaAvailable")


def n(v, default=0.0):
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except (TypeError, ValueError):
        return default


def mean(xs):
    xs = [x for x in xs if x is not None and math.isfinite(x)]
    return sum(xs) / len(xs) if xs else None


def load(path):
    return json.loads((DATA / path).read_text())


def save(path, value):
    (DATA / path).write_text(json.dumps(value, indent=2) + "\n")


def fmt(hm, away, home):
    if hm is None:
        return None
    if abs(hm) < .05:
        return "Pick"
    return f"{home if hm > 0 else away} -{abs(hm):.1f}".rstrip("0").rstrip(".")


def parse_spread(text, away, home):
    s = str(text or "").strip()
    if s.lower().startswith("pick"):
        return 0.0
    try:
        team, pts = s.rsplit(" ", 1)
        pts = abs(float(pts))
    except ValueError:
        return None
    norm = lambda x: "".join(ch for ch in str(x).lower() if ch.isalnum())
    if norm(team) == norm(home):
        return pts
    if norm(team) == norm(away):
        return -pts
    return None


def open_pbp(local_path):
    if local_path:
        return gzip.open(local_path, "rt", encoding="utf-8", newline="")
    req = urllib.request.Request(PBP_URL, headers={"User-Agent": "nfl-advanced-process-runtime/1.0"})
    return gzip.open(urllib.request.urlopen(req, timeout=60), "rt", encoding="utf-8", newline="")


def aggregate_pbp(through_week, local_path=None):
    off, de = defaultdict(lambda: defaultdict(list)), defaultdict(lambda: defaultdict(list))
    counts = defaultdict(lambda: defaultdict(int))
    with open_pbp(local_path) as fh:
        for r in csv.DictReader(fh):
            if r.get("season_type") != "REG" or int(n(r.get("week"))) > through_week:
                continue
            team, opp = ABBR.get(r.get("posteam"), r.get("posteam")), ABBR.get(r.get("defteam"), r.get("defteam"))
            if not team or not opp or r.get("play_type") not in {"pass", "run"} or n(r.get("qb_kneel")) == 1:
                continue
            epa, yards = n(r.get("epa"), None), n(r.get("yards_gained"), None)
            if epa is None:
                continue
            down, y100 = int(n(r.get("down"))), n(r.get("yardline_100"), 100)
            dropback = n(r.get("qb_dropback")) == 1 or r.get("play_type") == "pass"
            rush = n(r.get("rush_attempt")) == 1 or r.get("play_type") == "run"
            success = n(r.get("success"), 1.0 if epa > 0 else 0.0)
            explosive = 1.0 if (dropback and yards is not None and yards >= 20) or (rush and yards is not None and yards >= 10) else 0.0
            pressure = 1.0 if n(r.get("qb_hit")) == 1 or n(r.get("sack")) == 1 else 0.0
            sack = 1.0 if n(r.get("sack")) == 1 else 0.0
            turnover = 1.0 if n(r.get("interception")) == 1 or n(r.get("fumble_lost")) == 1 else 0.0
            neutral = down <= 2 and int(n(r.get("qtr"))) <= 3 and abs(n(r.get("score_differential"))) <= 8
            redzone = y100 <= 20
            third = down == 3
            stuff = rush and yards is not None and yards <= 0
            for bag in (off[team], de[opp]):
                bag["epa"].append(epa); bag["success"].append(success); bag["explosive"].append(explosive)
                bag["turnover"].append(turnover)
                if down <= 2: bag["earlyEpa"].append(epa); bag["earlySuccess"].append(success)
                if dropback:
                    bag["dropbackEpa"].append(epa); bag["dropbackSuccess"].append(success)
                    bag["pressure"].append(pressure); bag["sack"].append(sack)
                if rush:
                    bag["rushEpa"].append(epa); bag["rushSuccess"].append(success); bag["stuff"].append(1.0 if stuff else 0.0)
                if third: bag["thirdDown"].append(1.0 if n(r.get("third_down_converted")) == 1 else 0.0)
                if redzone: bag["redZoneSuccess"].append(success)
                if neutral: bag["neutralPass"].append(1.0 if dropback else 0.0)
            counts[team]["offPlays"] += 1; counts[opp]["defPlays"] += 1
    return off, de, counts


def zscores(rows, key):
    vals = [n(r["process"].get(key), None) for r in rows]
    vals = [v for v in vals if v is not None]
    mu = statistics.mean(vals) if vals else 0.0
    sd = statistics.pstdev(vals) if len(vals) > 1 else 1.0
    sd = sd or 1.0
    return {r["abbr"]: (n(r["process"].get(key)) - mu) / sd for r in rows}


def motion_advantage(interaction):
    rate = n(interaction.get("motionRate"), None)
    if rate is None:
        return 0.0
    severity = mean([PROFILE.get(interaction.get("defensePassVsMotion")), PROFILE.get(interaction.get("defenseRunVsMotion"))])
    if severity is None:
        return 0.0
    return max(-1.0, min(1.0, max(0.0, rate - .50) * severity * 4.0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbp-file", type=Path)
    args = ap.parse_args()
    stats, style, board, legacy = load("live-team-stats.json"), load("nfl-style-matchups.json"), load("weekly-board.json"), load("nfl-weekly-board.json")
    week = int(board["week"]); through = max(1, week - 1); now = datetime.now(timezone.utc).isoformat()
    off, de, counts = aggregate_pbp(through, args.pbp_file)
    style_by = {x["abbr"]: x for x in style.get("teams", [])}
    rows = stats.get("teams", [])
    for t in rows:
        a = ABBR.get(t.get("abbr"), t.get("abbr")); o, d = off[a], de[a]
        offense = {
            "plays": counts[a]["offPlays"], "epaPerPlay": mean(o["epa"]), "successRate": mean(o["success"]),
            "earlyDownEpa": mean(o["earlyEpa"]), "earlyDownSuccessRate": mean(o["earlySuccess"]),
            "dropbackEpa": mean(o["dropbackEpa"]), "dropbackSuccessRate": mean(o["dropbackSuccess"]),
            "rushEpa": mean(o["rushEpa"]), "rushSuccessRate": mean(o["rushSuccess"]),
            "explosivePlayRate": mean(o["explosive"]), "pressureRateAllowed": mean(o["pressure"]),
            "sackRateAllowed": mean(o["sack"]), "turnoverRate": mean(o["turnover"]),
            "neutralPassRate": mean(o["neutralPass"]), "thirdDownRatePbp": mean(o["thirdDown"]),
            "redZoneSuccessRate": mean(o["redZoneSuccess"]), "stuffRateAllowed": mean(o["stuff"]),
        }
        defense = {
            "plays": counts[a]["defPlays"], "epaAllowedPerPlay": mean(d["epa"]), "successRateAllowed": mean(d["success"]),
            "earlyDownEpaAllowed": mean(d["earlyEpa"]), "earlyDownSuccessRateAllowed": mean(d["earlySuccess"]),
            "dropbackEpaAllowed": mean(d["dropbackEpa"]), "dropbackSuccessRateAllowed": mean(d["dropbackSuccess"]),
            "rushEpaAllowed": mean(d["rushEpa"]), "rushSuccessRateAllowed": mean(d["rushSuccess"]),
            "explosivePlayRateAllowed": mean(d["explosive"]), "pressureRate": mean(d["pressure"]),
            "sackRate": mean(d["sack"]), "takeawayRate": mean(d["turnover"]),
            "thirdDownRateAllowedPbp": mean(d["thirdDown"]), "redZoneSuccessRateAllowed": mean(d["redZoneSuccess"]),
            "stuffRate": mean(d["stuff"]),
        }
        st = style_by.get(a, {}); so, sd = st.get("offense", {}), st.get("defenseVsMotion", {})
        offense.update({k: so.get(k) for k in ("motionRate", "playActionRate", "shotgunRate", "noHuddleRate", "airYardsPerAttempt")})
        defense.update({"motionPassProfile": sd.get("passProfile"), "motionRunProfile": sd.get("runProfile"), "motionNumericEpaAvailable": sd.get("numericEpaAvailable", False)})
        t["offense"] = {**t.get("offense", {}), **offense}; t["defense"] = {**t.get("defense", {}), **defense}
        t["units"] = {
            "passProtection": {"pressureRateAllowed": offense["pressureRateAllowed"], "sackRateAllowed": offense["sackRateAllowed"]},
            "receiving": {"epaPerTarget": offense["dropbackEpa"], "explosiveTargetRate": offense["explosivePlayRate"]},
            "runBlocking": {"rushEpa": offense["rushEpa"], "stuffRateAllowed": offense["stuffRateAllowed"]},
            "passRush": {"pressureRate": defense["pressureRate"], "sackRate": defense["sackRate"]},
            "coverage": {"epaPerTargetAllowed": defense["dropbackEpaAllowed"], "targetSuccessRateAllowed": defense["dropbackSuccessRateAllowed"], "explosiveTargetRateAllowed": defense["explosivePlayRateAllowed"]},
            "runDefense": {"rushEpaAllowed": defense["rushEpaAllowed"], "stuffRate": defense["stuffRate"]},
        }
        t["process"] = {
            "netEpa": n(offense["epaPerPlay"]) - n(defense["epaAllowedPerPlay"]),
            "netSuccess": n(offense["successRate"]) - n(defense["successRateAllowed"]),
            "netEarlyDownEpa": n(offense["earlyDownEpa"]) - n(defense["earlyDownEpaAllowed"]),
            "netDropbackEpa": n(offense["dropbackEpa"]) - n(defense["dropbackEpaAllowed"]),
            "netRushEpa": n(offense["rushEpa"]) - n(defense["rushEpaAllowed"]),
            "netExplosiveRate": n(offense["explosivePlayRate"]) - n(defense["explosivePlayRateAllowed"]),
            "netPressureRate": n(defense["pressureRate"]) - n(offense["pressureRateAllowed"]),
            "netSituationalRate": mean([n(offense["thirdDownRatePbp"]) - n(defense["thirdDownRateAllowedPbp"]), n(offense["redZoneSuccessRate"]) - n(defense["redZoneSuccessRateAllowed"])]) or 0.0,
        }
        # The raw ESPN response is normalized above and is not a portal/model input.
        # Dropping it keeps the browser-facing JSON compact and avoids transport
        # compression issues observed with the much larger redundant payload.
        t.pop("espnStatistics", None)
    zs = {k: zscores(rows, k) for k in COMPOSITE}
    for t in rows:
        z = sum(w * zs[k][t["abbr"]] for k, w in COMPOSITE.items())
        t["process"]["compositeZ"] = round(z, 4); t["process"]["ratingPoints"] = round(max(-5.0, min(5.0, z * 2.5)), 3)
        t["context"] = {**t.get("context", {}), "throughWeek": through, "advancedSource": "nflverse play-by-play", "leakageRule": f"Week {week} uses plays through Week {through} only"}
    stats.update({"updatedAt": now, "schemaVersion": "3.0-advanced-process-model", "advancedSource": PBP_URL, "advancedThroughWeek": through, "method": "Leakage-safe nflverse play-by-play advanced metrics plus ESPN standard stats and governed motion tendencies. Advanced process replaces 40% of the live scoring-margin input; motion matchup is capped at 0.25 structural points.", "teams": rows})
    by_abbr = {t["abbr"]: t for t in rows}; style_games = {x["gameId"]: x for x in style.get("games", [])}
    for g in board.get("games", []):
        a, h = by_abbr.get(g.get("awayAbbr")), by_abbr.get(g.get("homeAbbr"))
        if not a or not h:
            continue
        inp = g.get("modelInputs", {}); live_w = n(inp.get("liveWeight")); a_score, h_score = n(inp.get("awayLive")), n(inp.get("homeLive"))
        a_proc, h_proc = n(a["process"]["ratingPoints"]), n(h["process"]["ratingPoints"])
        process_adj = live_w * .40 * ((h_proc - h_score) - (a_proc - a_score))
        sg = style_games.get(g.get("gameId"), {}); away_i, home_i = sg.get("awayOffenseVsHomeDefense", {}), sg.get("homeOffenseVsAwayDefense", {})
        motion_raw = motion_advantage(home_i) - motion_advantage(away_i)
        motion_adj = max(-.25, min(.25, .25 * motion_raw))
        base_struct = n(g.get("baseStructuralHomeMargin", g.get("structuralHomeMargin")), None)
        market = parse_spread(g.get("currentSpread"), g.get("away"), g.get("home"))
        if base_struct is None:
            continue
        structural = base_struct + process_adj + motion_adj
        production = .8 * market + .2 * structural if market is not None else None
        edge = abs(structural - market) if market is not None else None
        lean = g.get("homeAbbr") if market is not None and structural > market else g.get("awayAbbr") if market is not None and structural < market else "NONE"
        g.update({"baseStructuralHomeMargin": round(base_struct, 3), "advancedProcessAdjustment": round(process_adj, 3), "motionMatchupAdjustment": round(motion_adj, 3), "structuralHomeMargin": round(structural, 3), "validatedStructuralSpread": fmt(structural, g["away"], g["home"]), "productionHomeMargin": None if production is None else round(production, 3), "productionSpread": fmt(production, g["away"], g["home"]), "structuralEdge": None if edge is None else round(edge, 3), "structuralLean": lean, "modelVersion": "NFL-v1.2 advanced process + capped motion-aware matchup"})
        g["modelInputs"] = {**inp, "advancedProcess": {"throughWeek": through, "offenseDefenseMetrics": list(COMPOSITE), "awayProcessRatingPoints": a_proc, "homeProcessRatingPoints": h_proc, "liveScoringMarginShare": .60, "liveAdvancedProcessShare": .40, "structuralAdjustment": round(process_adj, 3)}, "motionMatchup": {"source": "governed motion-rate + categorical defensive response", "directPointCap": .25, "structuralAdjustment": round(motion_adj, 3), "earlySample": True}}
    board.update({"updatedAt": now, "methodologyVersion": "1.2-advanced-process-motion-aware", "advancedProcessRuntime": {"status": "ACTIVE", "throughWeek": through, "teamCoverage": len(rows), "processShareOfLiveLayer": .40, "motionPointCap": .25, "leakageRule": f"Target Week {week} uses Weeks 1-{through} only"}})
    canon = {g["gameId"]: g for g in board.get("games", [])}
    for x in legacy.get("games", []):
        g = canon.get(x.get("canonical_game_id") or x.get("gameId"))
        if not g:
            continue
        market = n(x.get("market", {}).get("home_margin"), None); fair = g.get("productionHomeMargin")
        edge = None if market is None or fair is None else fair - market
        x["stage"], x["priority"] = g.get("stage", x.get("stage")), g.get("priority", x.get("priority"))
        x["model"] = {**x.get("model", {}), "fair_spread_display": g.get("productionSpread"), "fair_spread": g.get("productionSpread"), "fair_spread_home_margin": fair, "base_structural_home_margin": g.get("baseStructuralHomeMargin"), "advanced_process_adjustment": g.get("advancedProcessAdjustment"), "motion_matchup_adjustment": g.get("motionMatchupAdjustment"), "structural_home_margin": g.get("structuralHomeMargin"), "structural_fair": g.get("validatedStructuralSpread"), "structural_edge": g.get("structuralEdge"), "executable_edge": None if edge is None else round(edge, 3), "edge_side": g.get("homeAbbr") if edge and edge > 0 else g.get("awayAbbr") if edge and edge < 0 else "NONE", "model_version": g.get("modelVersion"), "advanced_process": g.get("modelInputs", {}).get("advancedProcess"), "motion_matchup": g.get("modelInputs", {}).get("motionMatchup"), "edge_reconciled_at": now}
    legacy.update({"generated_at": now, "model_methodology_version": "1.2-advanced-process-motion-aware", "advanced_process_runtime": board["advancedProcessRuntime"]})
    audit = {"season": stats.get("season"), "week": week, "verifiedAt": now, "status": "PASS" if len(rows) == 32 and all(t.get("process", {}).get("ratingPoints") is not None for t in rows) else "FAIL", "teamCoverage": len(rows), "throughWeek": through, "requiredMetricFamilies": list(COMPOSITE), "motionCoverage": sum(1 for t in rows if t.get("offense", {}).get("motionRate") is not None), "modelIntegration": {"processShareOfLiveLayer": .40, "motionPointCap": .25, "productionStructuralWeight": .20}, "leakageRule": f"Target Week {week} uses only completed plays through Week {through}."}
    # This file is fetched directly by the browser; compact serialization avoids
    # unnecessary transfer size while preserving the identical JSON contract.
    (DATA / "live-team-stats.json").write_text(json.dumps(stats, separators=(",", ":")) + "\n")
    advanced = {"season": stats.get("season"), "week": week, "updatedAt": now, "throughWeek": through, "source": "nflverse play-by-play + governed motion tendency sources", "schemaVersion": "1.0-browser-compact", "teams": [{"team": t.get("team"), "abbr": t.get("abbr"), "games": t.get("games"), "offense": {k: t.get("offense", {}).get(k) for k in ADV_OFF}, "defense": {k: t.get("defense", {}).get(k) for k in ADV_DEF}, "process": t.get("process", {}), "context": {"throughWeek": through, "advancedSource": "nflverse play-by-play"}} for t in rows]}
    (DATA / "live-team-advanced.json").write_text(json.dumps(advanced, separators=(",", ":")) + "\n")
    save("weekly-board.json", board); save("nfl-weekly-board.json", legacy); save(f"advanced-process-integrity-{stats.get('season')}-w{week}.json", audit)
    print(f"Advanced process runtime: teams={len(rows)} throughWeek={through} motion={audit['motionCoverage']} status={audit['status']}")


if __name__ == "__main__":
    main()
