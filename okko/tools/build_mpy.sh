#!/bin/sh
# Компиляция SDK в .mpy (mpy-cross той же версии, что прошивка) и заливка на устройство.
#   sh tools/build_mpy.sh            — собрать в build/
#   sh tools/build_mpy.sh upload     — собрать и залить через mpremote
set -e
cd "$(dirname "$0")/.."
rm -rf build && mkdir -p build/okko
for f in okko/*.py; do
  n=$(basename "$f" .py)
  if [ "$n" = "__init__" ]; then cp "$f" build/okko/; continue; fi
  mpy-cross -march=rv32imc -o "build/okko/$n.mpy" "$f"
done
cp main.py build/
if [ "$1" = "upload" ]; then
  mpremote mkdir :okko 2>/dev/null || true
  mpremote cp -r build/okko/ : + cp build/main.py :main.py + reset
fi
