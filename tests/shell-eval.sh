#!/usr/bin/env bash
# Evaluate JS in the nested test Shell and print the result value.
# Usage: tests/shell-eval.sh <state-dir> '<js>'   (exit 1 if the JS threw)
set -euo pipefail
T="$1"; shift
OUT=$(DBUS_SESSION_BUS_ADDRESS="$(cat "$T/bus")" gdbus call --session --dest org.gnome.Shell \
    --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1")
python3 -I - "$OUT" <<'PY'
import ast, json, sys
raw = sys.argv[1].strip()          # (true, '"value"')
ok = raw.startswith('(true')
rest = raw[raw.index(',') + 1:].strip()
text = ast.literal_eval(rest[:-1].strip()) if rest.endswith(')') else rest
try:
    value = json.loads(text) if text else ''
except Exception:
    value = text
print('' if value is None else value)
sys.exit(0 if ok else 1)
PY
