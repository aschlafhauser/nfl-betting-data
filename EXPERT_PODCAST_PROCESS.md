# NFL weekly podcast review

Podcast evidence is a qualitative layer. It cannot change production fair lines,
model weights, official wagers or units automatically.

1. Inventory the current week's public publisher RSS feeds before reviewing.
   Required families with public current programming: Mina Kimes / ESPN, Ringer,
   Establish The Run, Action Network, Sharp Football and You Better You Bet.
   PFF written analysis and official injury reporting are audited separately;
   former PFF employees' independent shows are not attributed to PFF.
2. Select comprehensive current-week previews plus material specialist segments.
   List excluded or superseded episodes with a reason. Do not count episode titles
   or HTTP availability as substantive episode review.
3. Use publisher transcripts when publicly available. Otherwise download the
   publisher's public RSS audio and transcribe it with a local speech-to-text
   model. Record the audio hash, duration, method and complete transcript hash.
   Reusable worker: `scripts/transcribe-podcast-audio.py` accepts the explicit
   inventory and resumes completed local transcripts; use an output directory
   outside this public repository. It does not certify manual review.
   Keep full audio/transcripts out of this public repository; persist concise
   paraphrases, provenance, extraction decisions and timestamp locators here.
4. Inspect NFL material, preserving the analyst's qualifications and exact stated
   constructions. Label automatic transcription and uncertain speaker/price
   recognition. Correct player identities against official rosters. Withhold any
   uncertain price. Hypothetical lines, fantasy projections, listener submissions
   and promotional reads never become expert prop recommendations.
5. Every extracted record needs the selected season/week and canonical game ID,
   family, analyst, source publication date, timestamp range, direction, category,
   conviction (or not stated), evidence method, independence and model relationship.
   Same-show contributors are one correlated family; disagreement stays visible.
6. Add review audits under data/expert-episode-audit and update
   data/expert-podcast-process-current.json with explicit per-episode completeness.
   Append qualifying props only when a source explicitly specifies the player,
   direction and threshold. Source odds are never marked as current book quotes.
7. Run sync-expert-ledger.mjs, verify-podcast-process.mjs, and the governed refresh
   pipeline. Verify live Expert Intelligence, per-game Matchup Center joins and
   Player Props. Full episode coverage, attributable records, and executable odds
   are separate checks. Empty extraction is valid only after the episode was
   actually reviewed, with the reason recorded.
8. Preserve pre-kickoff evidence and completed-game history. Future weekly reviews
   create new selected-week inventories; they never rewrite an earlier review.
