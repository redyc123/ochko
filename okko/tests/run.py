# Запуск тестов без pytest (MicroPython unix-порт или CPython):
#   micropython tests/run.py      python3 tests/run.py
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "tests")

MODULES = ("test_protocol", "test_packbits", "test_gesture", "test_adpcm")

failed = 0
total = 0
for name in MODULES:
    m = __import__(name)
    for attr in sorted(dir(m)):
        if attr.startswith("test_"):
            total += 1
            try:
                getattr(m, attr)()
                print("ok  ", name, attr)
            except Exception as e:
                failed += 1
                print("FAIL", name, attr, repr(e))
print("%d/%d passed" % (total - failed, total))
sys.exit(1 if failed else 0)
