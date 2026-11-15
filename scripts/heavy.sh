#!/bin/bash
set -e
set -m
if [ "$#" -eq 0 ]; then echo 'usage: scripts/heavy.sh <command...>' >&2; exit 2; fi
slots=${TANGENT_HEAVY_SLOTS:-2}
case "$slots" in ''|*[!0-9]*|0) echo 'TANGENT_HEAVY_SLOTS must be a positive integer' >&2; exit 2;; esac
root=/tmp/tangent-heavy
mkdir -p "$root"
slot=''
child=''
cleanup() {
    if [ -n "$child" ]; then kill -TERM -- "-$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi
    if [ -n "$slot" ] && [ "$(cat "$slot/pid" 2>/dev/null)" = "$$" ]; then
        rm -f "$slot/pid"
        rmdir "$slot" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
waiting=0
while [ -z "$slot" ]; do
    for ((i=1; i<=slots; i++)); do
        candidate="$root/slot-$i"
        if mkdir "$candidate" 2>/dev/null; then
            slot=$candidate
            echo "$$" > "$slot/pid"
            break
        fi
        owner=$(cat "$candidate/pid" 2>/dev/null || true)
        # An empty slot may belong to a process between mkdir and writing its PID.
        if [[ "$owner" =~ ^[0-9]+$ ]] && ! kill -0 "$owner" 2>/dev/null && mkdir "$candidate/reclaim" 2>/dev/null; then
            if [ "$(cat "$candidate/pid" 2>/dev/null)" = "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then rm -f "$candidate/pid"; fi
            rmdir "$candidate/reclaim" 2>/dev/null || true
            rmdir "$candidate" 2>/dev/null || true
        fi
    done
    if [ -z "$slot" ]; then
        if [ "$waiting" -eq 0 ]; then echo 'waiting for a heavy slot' >&2; waiting=1; fi
        sleep 1
    fi
done
policy=()
if [ "$(uname)" = Darwin ]; then
    # pmset -g therm fails on this Mac; Foundation reports 0=nominal through 3=critical.
    thermal=$(osascript -l JavaScript -e 'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.thermalState' 2>/dev/null || true)
    case "$thermal" in
        2|3) echo "warning: thermal state $thermal; using taskpolicy -b" >&2; policy=(taskpolicy -b);;
        0|1) ;;
        *) echo 'warning: thermal state unavailable' >&2;;
    esac
fi
CARGO_BUILD_JOBS=3 nice -n 10 "${policy[@]}" "$@" &
child=$!
status=0
wait "$child" || status=$?
child=''
exit "$status"
