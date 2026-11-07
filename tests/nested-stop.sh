#!/usr/bin/env bash
# Stop only the nested test Shell (never the real one).
pkill -f '^gnome-shell --nested' || true
