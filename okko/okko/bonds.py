# Хранилище ключей бондинга во flash (по образцу examples/bluetooth/ble_bonding_peripheral.py).
# Сохраняется при каждом изменении, а не только при разрыве.
import binascii
import json


def _b64(b):
    return binascii.b2a_base64(b).decode().strip()


class Bonds:
    def __init__(self, path):
        self.path = path
        self.secrets = {}
        self.load()

    def load(self):
        try:
            with open(self.path, "r") as f:
                for t, k, v in json.load(f):
                    self.secrets[t, binascii.a2b_base64(k)] = binascii.a2b_base64(v)
        except (OSError, ValueError):
            pass

    def save(self):
        try:
            with open(self.path, "w") as f:
                json.dump([(t, _b64(k), _b64(v))
                           for (t, k), v in self.secrets.items()], f)
        except OSError:
            pass

    def get(self, sec_type, index, key):
        if key is None:
            i = 0
            for (t, _k), v in self.secrets.items():
                if t == sec_type:
                    if i == index:
                        return v
                    i += 1
            return None
        return self.secrets.get((sec_type, bytes(key)), None)

    def set(self, sec_type, key, value):
        k = (sec_type, bytes(key))
        if value is None:
            self.secrets.pop(k, None)
        else:
            self.secrets[k] = bytes(value)
        self.save()
        return True

    def clear(self):
        self.secrets = {}
        self.save()
