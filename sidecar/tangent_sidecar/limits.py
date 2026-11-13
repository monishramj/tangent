"""CPU politeness + orphan protection for the sidecar (stdout is reserved for RPC)."""

import os
import threading
import time

THREAD_VARS = ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS")


def threads() -> int:
    """TANGENT_SIDECAR_THREADS, else ~30% of cores (4 on a 14-core Mac), at least 2."""
    try:
        n = int(os.environ["TANGENT_SIDECAR_THREADS"])
        if n > 0:
            return n
    except (KeyError, ValueError):
        pass
    return max(2, round((os.cpu_count() or 4) * 0.3))


def limit_torch() -> None:
    import torch

    torch.set_num_threads(threads())


def apply_limits() -> None:
    n = str(threads())
    for var in THREAD_VARS:  # before numpy/torch load their BLAS pools
        os.environ[var] = n
    try:
        os.nice(10)  # ponytail: whole process; split per-job QoS only if interactive TTS latency suffers
    except OSError:
        pass


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    return True


def parent_gone(orig_ppid: int, watched: int | None) -> bool:
    return os.getppid() != orig_ppid or (watched is not None and not _alive(watched))


def start_watchdog(interval: float = 1.0, exit=os._exit) -> threading.Thread:
    """Exit when the parent goes away, even while Docling holds the main thread.
    TANGENT_PARENT_PID is the app's pid: `uv run` may sit between us and it."""
    orig = os.getppid()
    watched = int(os.environ["TANGENT_PARENT_PID"]) if os.environ.get("TANGENT_PARENT_PID", "").isdigit() else None

    def run():
        while not parent_gone(orig, watched):
            time.sleep(interval)
        exit(0)

    t = threading.Thread(target=run, daemon=True, name="parent-watchdog")
    t.start()
    return t
