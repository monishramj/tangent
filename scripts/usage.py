#!/usr/bin/env python3
"""Local token accounting; cached/reasoning columns are subsets of input/output."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

HOME = Path.home()
WORKTREES = HOME / 'Documents/Code/orca/workspaces/tangent'
REPO = Path(subprocess.check_output(
    ['git', '-C', str(Path(__file__).resolve().parent), 'rev-parse', '--git-common-dir'],
    text=True).strip())
if not REPO.is_absolute():
    REPO = Path(__file__).resolve().parent / REPO
REPO = REPO.resolve().parent
FIELDS = ('input', 'cached_input', 'output', 'reasoning', 'total')


def timestamp(value):
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)


def lines(path):
    try:
        with path.open(errors='replace') as stream:
            for line in stream:
                try:
                    yield json.loads(line)
                except ValueError:
                    continue  # Active logs can end with an incomplete line.
    except OSError as error:
        print(f'{path}: {error}', file=sys.stderr)


def tokens(usage, claude=False):
    inp = usage.get('input_tokens', 0)
    cached = usage.get('cached_input_tokens', usage.get('cache_read_input_tokens', 0))
    if claude:
        inp += cached + usage.get('cache_creation_input_tokens', 0)
    out = usage.get('output_tokens', 0)
    reasoning = usage.get('reasoning_output_tokens', usage.get('output_tokens_details', {}).get('thinking_tokens', 0))
    return (inp, cached, out, reasoning, usage.get('total_tokens', inp + out))


def claude_records(rows, session, since):
    messages = {}
    cwd = ''
    for row in rows:
        cwd = row.get('cwd', cwd)
        message = row.get('message', {})
        if row.get('type') == 'assistant' and message.get('id') and message.get('usage'):
            if timestamp(row.get('timestamp')) >= since:
                messages[message['id']] = ('claude', message.get('model', 'unknown'),
                                           session, cwd, tokens(message['usage'], True))
    return messages.values()


def codex_records(rows, session, since):
    model, cwd, latest = 'unknown', '', None
    for row in rows:
        payload = row.get('payload', {})
        model = row.get('model', payload.get('model', model))
        cwd = row.get('cwd', payload.get('cwd', cwd))
        if row.get('type') == 'token_count' or payload.get('type') == 'token_count':
            usage = (payload.get('info') or row.get('info') or {}).get('total_token_usage')
            if usage and timestamp(row.get('timestamp')) >= since:
                latest = ('codex', model, session, cwd, tokens(usage))
    # Codex's counters are session totals, including earlier turns in a qualifying session.
    return [latest] if latest else []


def cursor_status():
    root = HOME / '.cursor'
    looked = '~/.cursor/{ai-tracking,chats,agent-cli-state.json}'
    token_keys = set()

    def inspect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if 'token' in key.lower() or 'usage' in key.lower():
                    token_keys.add(key)
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    for path in [root / 'agent-cli-state.json', *root.glob('chats/*/*/meta.json')]:
        if path.exists():
            try:
                inspect(json.loads(path.read_text()))
            except (OSError, ValueError):
                pass
    for path in [*root.glob('ai-tracking/*.db'), *root.glob('chats/*/*/store.db')]:
        try:
            # Immutable avoids creating WAL/shm files in the user's data directories.
            with sqlite3.connect(f'file:{path}?mode=ro&immutable=1', uri=True) as db:
                for name, in db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                    quoted = '"' + name.replace('"', '""') + '"'
                    columns = [r[1] for r in db.execute(f'PRAGMA table_info({quoted})')]
                    token_keys.update(c for c in columns if 'token' in c.lower() or 'usage' in c.lower())
                    if name in ('blobs', 'meta'):
                        column = 'data' if name == 'blobs' else 'value'
                        for value, in db.execute(f'SELECT {column} FROM {quoted}'):
                            try:
                                inspect(json.loads(value))
                            except (ValueError, TypeError, UnicodeDecodeError):
                                pass
        except sqlite3.Error as error:
            print(f'{path}: {error}', file=sys.stderr)
    if token_keys:
        return f'cursor: unrecognized token fields ({", ".join(sorted(token_keys))}); no counts inferred ({looked})'
    return f'cursor: no token data found ({looked})'


def selftest():
    since = timestamp('2026-11-15T00:00:00Z')
    sample = json.loads('{"type":"assistant","timestamp":"2026-11-15T01:00:00Z","cwd":"/tangent/a","message":{"id":"m1","model":"claude","usage":{"input_tokens":2,"cache_creation_input_tokens":3,"cache_read_input_tokens":5,"output_tokens":7,"output_tokens_details":{"thinking_tokens":4}}}}')
    assert list(claude_records([sample, sample], 's', since))[0][-1] == (10, 5, 7, 4, 17)
    assert len(list(claude_records([sample, sample], 's', since))) == 1
    assert not list(claude_records([sample], 's', timestamp('2026-11-16T00:00:00Z')))
    context = json.loads('{"type":"turn_context","payload":{"model":"codex","cwd":"/tangent/a"}}')
    count = json.loads('{"type":"event_msg","timestamp":"2026-11-15T01:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":20,"cached_input_tokens":10,"output_tokens":8,"reasoning_output_tokens":3,"total_tokens":28}}}}')
    assert codex_records([context, count, count], 's', since)[0][-1] == (20, 10, 8, 3, 28)
    assert len(codex_records([context, count, count], 's', since)) == 1
    assert not codex_records([count], 's', timestamp('2026-11-16T00:00:00Z'))
    assert tokens(json.loads('{"input_tokens":10,"output_tokens":2}')) == (10, 0, 2, 0, 12)
    print('usage selftest: passed (Claude, Codex; Cursor stores inspected, no token format present)')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--since', default='1970-01-01T00:00:00Z', help='UTC timestamp; Codex includes full totals for sessions active since this time')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--by', choices=['worktree'])
    parser.add_argument('--all', action='store_true', help='Include paths outside tangent')
    parser.add_argument('--selftest', action='store_true')
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    try:
        since = timestamp(args.since)
    except ValueError:
        parser.error('--since must be an ISO-8601 timestamp')
    groups = defaultdict(lambda: {'sessions': set(), **dict.fromkeys(FIELDS, 0)})
    for root, pattern, parse in [('.claude/projects', '*/*.jsonl', claude_records), ('.codex/sessions', '**/*.jsonl', codex_records)]:
        for path in (HOME / root).glob(pattern):
            for agent, model, session, cwd, counts in parse(lines(path), str(path), since):
                project = Path(cwd) if cwd else None
                if not args.all and not (project and (project == WORKTREES or WORKTREES in project.parents or project == REPO or REPO in project.parents)):
                    continue
                if project and WORKTREES in project.parents:
                    project = WORKTREES / project.relative_to(WORKTREES).parts[0]
                key = (agent, model, str(project or 'unknown') if args.by else '')
                group = groups[key]
                group['sessions'].add(session)
                for field, value in zip(FIELDS, counts):
                    group[field] += value
    output = [dict(agent=k[0], model=k[1], **({'worktree': k[2]} if args.by else {}),
                   **{**v, 'sessions': len(v['sessions'])}) for k, v in sorted(groups.items())]
    cursor = cursor_status()
    if args.json:
        print(json.dumps({'usage': output, 'cursor': cursor, 'note': 'Codex uses full session totals; cached input/reasoning are subsets.'}, indent=2))
    else:
        columns = ['agent', 'model', *(['worktree'] if args.by else []), 'sessions', *FIELDS]
        cells = [[str(row[c]) for c in columns] for row in output]
        widths = [max(len(c), *(len(r[i]) for r in cells)) if cells else len(c) for i, c in enumerate(columns)]
        for row in [columns, *cells]:
            print('  '.join(value.ljust(width) for value, width in zip(row, widths)))
        print(cursor)
        print('Codex: full totals for sessions active since --since; cached input/reasoning are subsets.')


if __name__ == '__main__':
    main()
