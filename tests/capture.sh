#!/usr/bin/env bash
# Capture the nested Shell window (host X11) to a PNG. Usage: tests/capture.sh out.png
set -euo pipefail
WID=$(xwininfo -root -tree | awk '/"gnome-shell": \(\)  1920x540/ {print $1; exit}')
[[ -n "$WID" ]] || { echo "nested window not found" >&2; exit 1; }
import -window "$WID" "$1"
