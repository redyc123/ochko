# SDK прошивки смарт-очков О.Ч.К.О.
from .config import Config
from .protocol import CH_DISPLAY, CH_CONTROL

try:
    from .sdk import Glasses
except ImportError:
    # нет machine/bluetooth (ПК, unix-порт): доступны только чистые модули
    pass
