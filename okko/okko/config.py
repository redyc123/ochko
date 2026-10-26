# Конфигурация О.Ч.К.О.: все пины, тайминги и режимы в одном месте.
# Любое поле можно переопределить: Config(device_name="OCHKO2", mirror="none").

LOG_OFF = 0
LOG_INFO = 1
LOG_DEBUG = 2  # + hex входящих и исходящих пакетов


class Config:
    # Версия прошивки (уходит в info)
    fw_version = (0, 1, 0)

    # BLE
    device_name = "OCHKO"
    adv_interval_ms = 300
    mtu = 247
    bonds_file = "bonds.json"

    # RF-переключатель XIAO ESP32-C6 (вики Seeed: GPIO3 = LOW включает
    # управление переключателем, GPIO14: LOW встроенная антенна, HIGH внешняя).
    # Проверить на своей плате; None — не трогать.
    rf_switch_pin = 3
    rf_switch_level = 0
    ant_select_pin = 14
    ant_external = False

    # Экран SSD1306 72x40 по I2C
    i2c_id = 0
    i2c_sda = 22  # D4
    i2c_scl = 23  # D5
    i2c_freq = 400_000
    oled_addr = 0x3C
    oled_col_offset = 28  # окно 72 столбца из 128 по центру, проверить на модуле
    oled_contrast = 0xAF
    # Зеркалирование оптики: "h" (по умолчанию), "v", "hv", "none". Делается битами контроллера.
    mirror = "h"
    # Без связи: True — показать «NO LINK», False — погасить панель (экономия)
    show_no_link = True

    # Кнопка: на землю, внутренняя подтяжка, активный 0
    button_pin = 1  # D1
    debounce_ms = 30
    hold_ms = 600
    double_ms = 300  # 0 — двойное нажатие выключено
    button_poll_ms = 8

    # Микрофон INMP441, I2S. mic_sck = None — микрофона нет.
    i2s_id = 0
    mic_sck = 19  # D8
    mic_ws = 20  # D9
    mic_sd = 18  # D10
    mic_rate = 16000
    mic_ibuf = 8192
    mic_shift = 14  # 32-битный слот -> int16

    # Батарея: пин АЦП с делителем; None — события BATTERY нет
    battery_adc_pin = None
    battery_divider = 2.0  # Vbat = Vadc * divider
    battery_min_mv = 3300
    battery_max_mv = 4200
    battery_period_s = 300  # не чаще раза в 5 минут

    # Уведомления iPhone (ANCS); на Android сервиса нет, клиент просто молчит
    ancs = True

    # Надёжность
    wdt_timeout_ms = 8000  # 0 — без сторожевого таймера
    rx_queue_len = 8
    cpu_freq = None  # None — не трогать; 80_000_000 проверять замером

    log_level = LOG_INFO

    def __init__(self, **kw):
        for k, v in kw.items():
            if not hasattr(self, k):
                raise AttributeError(k)
            setattr(self, k, v)
