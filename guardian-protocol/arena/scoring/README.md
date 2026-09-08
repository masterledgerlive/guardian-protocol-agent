# Scoring (Sprint 2+)

`leaderboard.js` scores Arena reports vs the FIFO baseline with visible weights:

- absolute composite
- cheapest / fastest / smallest overhead / most improved
- Pareto frontier on cost × latency (successful runs only)

Evidence fields (hashes, exact_match) travel with every score row.
