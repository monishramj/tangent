# Local worker operations
Workers wrap heavy commands with `scripts/heavy.sh` and run `scripts/reap.sh --kill-orphans` before worker_done.
- `scripts/heavy.sh cargo test --manifest-path src-tauri/Cargo.toml` waits for one of two global slots.
- `TANGENT_HEAVY_SLOTS=2` controls the shared limit; use the same value in every worker.
- Commands run with nice 10 and `CARGO_BUILD_JOBS=3`; serious/critical macOS heat also enables `taskpolicy -b`.
- Slots in `/tmp/tangent-heavy` contain owner PIDs; dead owners are reclaimed; signals release slots.
- `scripts/reap.sh` lists heavy processes, parents, CPU, age, and cwd without changing anything.
- `scripts/reap.sh --kill-orphans` sends TERM only to PPID-1 processes or processes in deleted Orca worktrees.
- The main checkout and unknown cwd are protected unless `--all`; inspect the list first.
- `python3 scripts/usage.py --since 2026-11-15T08:23:57Z` reports tangent token totals by agent/model.
- Add `--by worktree`, `--all` (all projects), or `--json`; `bun run usage --since …` also works.
- Claude messages are deduplicated; Codex uses the last full session total for sessions active since the cutoff.
- Input includes cache reads/writes; cached input and reasoning are subsets, so do not add them again.
- Cursor's local tracking/chat databases and CLI state are inspected; absent counts are reported without estimates.
- `python3 scripts/usage.py --selftest` checks sample accounting; no models or dependencies are needed.
