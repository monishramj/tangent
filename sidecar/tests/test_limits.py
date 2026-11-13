import os
import subprocess
import sys
import time

from tangent_sidecar import limits


def test_threads_env_and_default(monkeypatch):
    monkeypatch.setenv("TANGENT_SIDECAR_THREADS", "3")
    assert limits.threads() == 3
    monkeypatch.setenv("TANGENT_SIDECAR_THREADS", "junk")
    assert limits.threads() >= 2
    monkeypatch.delenv("TANGENT_SIDECAR_THREADS")
    monkeypatch.setattr(os, "cpu_count", lambda: 14)
    assert limits.threads() == 4


def test_apply_sets_blas_env(monkeypatch):
    monkeypatch.setenv("TANGENT_SIDECAR_THREADS", "3")
    monkeypatch.setattr(os, "nice", lambda n: 0)
    for v in limits.THREAD_VARS:
        monkeypatch.setenv(v, "x")  # registers restore-on-teardown
    limits.apply_limits()
    assert all(os.environ[v] == "3" for v in limits.THREAD_VARS)


def test_watchdog_exits_when_parent_dies():
    # parent sh spawns the child python, prints its pid, then exits; the child must die by itself.
    code = ("import time;from tangent_sidecar import limits;"
            "limits.start_watchdog(0.1);time.sleep(30)")
    out = subprocess.run(["sh", "-c", f"{sys.executable} -c '{code}' >/dev/null 2>&1 & echo $!; sleep 3"],
                         capture_output=True, text=True, timeout=20).stdout
    pid = int(out.strip())
    for _ in range(50):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    os.kill(pid, 9)
    raise AssertionError("sidecar outlived its parent")
