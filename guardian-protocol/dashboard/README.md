# Dashboard (Sprint 2)

```bash
cd guardian-protocol
npm run dashboard
# → http://127.0.0.1:8787
```

Surfaces:

- `/` — system / strategies / leaderboard / reports / adapter stubs
- `/api/system` — preserved volume, registry, treasury/storage snapshot
- `/api/leaderboard` — absolute / cheapest / fastest / improved + Pareto
- `/api/replay/:reportJson` — event list + inspect first event
- `/api/strategies` · `/api/adapters` · `/api/reports`

All numbers are **simulated** Arena evidence from `arena/reports/`.
