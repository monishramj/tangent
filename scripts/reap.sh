#!/bin/sh
exec python3 - "$@" <<'PY'
import argparse
import os
from pathlib import Path
import re
import signal
import subprocess

parser = argparse.ArgumentParser(description='List heavy processes; optionally terminate confirmed orphans.')
parser.add_argument('--kill-orphans', action='store_true')
parser.add_argument('--all', action='store_true', help='Allow orphan cleanup in the main checkout too')
args = parser.parse_args()
worktrees = Path.home() / 'Documents/Code/orca/workspaces/tangent'
common = subprocess.check_output(['git', 'rev-parse', '--git-common-dir'], text=True).strip()
main = Path(common).resolve().parent
pattern = re.compile(r'(?:^|[/\s])(?:vite|vitest|cargo|rustc)(?:\s|$|/)|tauri\s+dev|tangent_sidecar|(?:chrome|chromium|Google Chrome).*--headless', re.I)


def cwd_for(pid):
    result = subprocess.run(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], capture_output=True, text=True)
    return next((line[1:] for line in result.stdout.splitlines() if line.startswith('n')), '')


print('PID     PPID    CPU%   AGE          CWD / WORKTREE  COMMAND')
rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,%cpu=,etime=,command='], text=True)
for line in rows.splitlines():
    parts = line.split(None, 4)
    if len(parts) != 5:
        continue
    pid, ppid, cpu, age, command = parts
    if int(pid) == os.getpid() or not pattern.search(command):
        continue
    cwd = cwd_for(pid)
    clean_cwd = cwd.removesuffix(' (deleted)')
    path = Path(clean_cwd).resolve() if clean_cwd else None
    worktree = None
    if path and worktrees in path.parents:
        worktree = worktrees / path.relative_to(worktrees).parts[0]
    orphan = ppid == '1' or (worktree is not None and not worktree.exists())
    protected = path is None or path == main or main in path.parents
    action = ''
    if args.kill_orphans and orphan and (args.all or not protected):
        # Recheck identity/parent immediately before sending TERM; never escalate to KILL.
        current = subprocess.run(['ps', '-p', pid, '-o', 'ppid=,command='], capture_output=True, text=True).stdout.strip()
        if current.split(None, 1) == [ppid, command] and cwd_for(pid) == cwd:
            try:
                os.kill(int(pid), signal.SIGTERM)
                action = ' [TERM sent]'
            except ProcessLookupError:
                action = ' [exited]'
            except PermissionError:
                action = ' [permission denied]'
    elif args.kill_orphans and orphan and protected and not args.all:
        action = ' [protected main/unknown cwd]'
    print(f'{pid:<7} {ppid:<7} {cpu:<6} {age:<12} {cwd or "unknown"}  {command}{action}')
PY
