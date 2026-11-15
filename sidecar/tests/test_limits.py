import os
import subprocess
import sys
import time
from types import SimpleNamespace

import pytest

from tangent_sidecar import limits


def test_threads_env_and_default(monkeypatch):
    monkeypatch.setenv("TANGENT_SIDECAR_THREADS", "3")
    assert limits.threads() == 3
    monkeypatch.setenv("TANGENT_SIDECAR_THREADS", "junk")
    assert 1 <= limits.threads() <= 6
    monkeypatch.delenv("TANGENT_SIDECAR_THREADS")
    monkeypatch.setattr(os, "cpu_count", lambda: 14)
    assert limits.threads() == 4


def test_apply_sets_blas_env(monkeypatch):
    monkeypatch.setenv("TANGENT_SIDECAR_THREADS", "3")
    monkeypatch.setattr(limits, "set_work_priority", lambda kind: None)
    for v in limits.THREAD_VARS:
        monkeypatch.setenv(v, "x")  # registers restore-on-teardown
    limits.apply_limits()
    assert all(os.environ[v] == "3" for v in limits.THREAD_VARS)


@pytest.mark.skipif(os.name == "nt", reason="POSIX orphan fixture; Windows liveness is simulated below")
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


@pytest.mark.parametrize("platform,background,expected", [
    ("linux", True, 19), ("linux", False, 0),
    ("darwin", True, 19), ("darwin", False, 0),
])
def test_unix_priority_selection(monkeypatch, platform, background, expected):
    calls = []
    monkeypatch.setattr(sys, "platform", platform)
    monkeypatch.setattr(os, "setpriority", lambda *args: calls.append(args), raising=False)
    monkeypatch.setattr(os, "PRIO_PROCESS", 0, raising=False)
    monkeypatch.setattr(os, "PRIO_DARWIN_PROCESS", 3, raising=False)
    monkeypatch.setattr(os, "PRIO_DARWIN_BG", 0x1000, raising=False)
    limits.set_work_priority("background" if background else "foreground")
    assert calls[0] == (os.PRIO_PROCESS, 0, expected)
    assert calls[1:] == ([(3, 0, 0x1000)] if platform == "darwin" and background else [])


@pytest.mark.parametrize("kind,expected", [("background", 0x40), ("foreground", 0x20)])
def test_windows_priority_selection(monkeypatch, kind, expected):
    import ctypes
    from unittest.mock import Mock
    kernel = SimpleNamespace(GetCurrentProcess=Mock(return_value=123), SetPriorityClass=Mock(return_value=1))
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(ctypes, "WinDLL", lambda *a, **k: kernel, raising=False)
    limits.set_work_priority(kind)
    kernel.SetPriorityClass.assert_called_once_with(123, expected)


def test_thread_cap(monkeypatch):
    monkeypatch.setenv("TANGENT_SIDECAR_THREADS", "99")
    assert limits.threads() == 6
    monkeypatch.delenv("TANGENT_SIDECAR_THREADS")
    monkeypatch.setattr(os, "cpu_count", lambda: 1)
    assert limits.threads() == 1
    monkeypatch.setattr(os, "cpu_count", lambda: 128)
    assert limits.threads() == 6


def test_thermal_pause_and_resume():
    states = iter([2, 3, 1])
    events = []
    limits.wait_until_cool(source=lambda: next(states), sleep=lambda seconds: events.append(seconds),
                           paused=lambda: events.append("paused"))
    assert events == ["paused", 5, "paused", 5]


def test_unknown_thermal_state_does_not_hang():
    limits.wait_until_cool(source=lambda: None, sleep=lambda _: pytest.fail("slept"))


def test_macos_thermal_source(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: SimpleNamespace(stdout="2\n"))
    assert limits.thermal_state() == 2
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: SimpleNamespace(stdout="unknown"))
    assert limits.thermal_state() is None


@pytest.mark.parametrize("exit_code,alive", [(259, True), (0, False)])
def test_windows_watchdog_queries_without_signalling(monkeypatch, exit_code, alive):
    import ctypes
    from unittest.mock import Mock
    def get_exit(handle, result):
        result._obj.value = exit_code
        return 1
    kernel = SimpleNamespace(OpenProcess=Mock(return_value=123),
                             GetExitCodeProcess=Mock(side_effect=get_exit), CloseHandle=Mock())
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(ctypes, "WinDLL", lambda *a, **k: kernel, raising=False)
    monkeypatch.setattr(os, "kill", lambda *a: pytest.fail("Windows parent was signalled"))
    assert limits._alive(456) is alive
    kernel.CloseHandle.assert_called_once_with(123)


def test_watchdog_detects_dead_wrapper_even_if_ppid_is_cached(monkeypatch):
    monkeypatch.setattr(os, "getppid", lambda: 123)
    monkeypatch.setattr(limits, "_alive", lambda pid: pid != 123)
    assert limits.parent_gone(123, 456)
