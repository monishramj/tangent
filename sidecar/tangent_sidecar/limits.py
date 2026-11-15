"""CPU politeness + orphan protection for the sidecar (stdout is reserved for RPC)."""

import os
import subprocess
import sys
import threading
import time

THREAD_VARS = ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS")


def threads() -> int:
    """TANGENT_SIDECAR_THREADS, else ~30% of cores (4 on a 14-core Mac), max 6, at least 1."""
    try:
        n = int(os.environ["TANGENT_SIDECAR_THREADS"])
        if n > 0:
            return min(6, n)
    except (KeyError, ValueError):
        pass
    return min(6, max(1, (os.cpu_count() or 4) * 3 // 10))


def limit_torch() -> None:
    import torch

    torch.set_num_threads(threads())


def apply_limits() -> None:
    n = str(threads())
    for var in THREAD_VARS:  # before numpy/torch load their BLAS pools
        os.environ[var] = n
    set_work_priority(os.environ.get("TANGENT_WORK_CLASS", "foreground"))


def set_work_priority(work_class):
    """Background workers stay background: raising Unix nice again requires privileges."""
    background = work_class == "background"
    try:
        if sys.platform == "win32":
            import ctypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.GetCurrentProcess.restype = ctypes.c_void_p
            kernel.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
            if not kernel.SetPriorityClass(kernel.GetCurrentProcess(), 0x40 if background else 0x20):
                raise ctypes.WinError(ctypes.get_last_error())
        else:
            # os.nice / os.setpriority are Unix-only; Windows uses the branch above.
            setpriority = getattr(os, "setpriority", None)
            if setpriority is None:
                print(f"sidecar priority ({work_class}): os.setpriority is unavailable", file=sys.stderr)
                return
            setpriority(getattr(os, "PRIO_PROCESS", 0), 0, 19 if background else 0)
            if sys.platform == "darwin" and background:
                setpriority(os.PRIO_DARWIN_PROCESS, 0, os.PRIO_DARWIN_BG)
    except OSError as error:
        print(f"sidecar priority ({work_class}): {error}", file=sys.stderr)


def thermal_state():
    """NSProcessInfo: 0 nominal, 1 fair, 2 serious, 3 critical; unavailable is unknown."""
    if sys.platform != "darwin":
        return None
    try:
        result = subprocess.run(
            ["/usr/bin/osascript", "-l", "JavaScript", "-e",
             'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.thermalState'],
            capture_output=True, text=True, timeout=5, check=True,
        )
        return int(result.stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def wait_until_cool(source=None, sleep=None, paused=lambda: None):
    source = source or thermal_state
    sleep = sleep or time.sleep
    while source() in (2, 3):
        paused()
        sleep(5)


def _alive(pid: int) -> bool:
    if sys.platform == "win32":
        # os.kill(pid, 0) terminates processes on Windows; query a handle instead.
        import ctypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() != 87  # invalid PID; access denied still means alive
        try:
            code = ctypes.c_uint32()
            return not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    return True


def parent_gone(orig_ppid: int, watched: int | None) -> bool:
    return os.getppid() != orig_ppid or not _alive(orig_ppid) or (watched is not None and not _alive(watched))


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
