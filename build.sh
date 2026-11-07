#!/usr/bin/env bash
# Build an installable zip: dist/deepdim@joseteo.github.com.shell-extension.zip
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mkdir -p dist
gnome-extensions pack --force --out-dir dist \
    --extra-source=lib --extra-source=prefs --extra-source=icons --extra-source=LICENSE \
    --schema=schemas/org.gnome.shell.extensions.deepdim.gschema.xml .
ls -l dist
