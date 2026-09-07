"""
Cấu hình cho module ML dự đoán thời gian giao hàng.
"""
import os
from dotenv import load_dotenv
from pathlib import Path

# Load .env từ backend/
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ── Database ──────────────────────────────────────────
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 5433)),
    "dbname": os.getenv("DB_NAME", "CADAO"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "123456"),
}

# ── Ward distance tiers (từ nhà hàng Ninh Kiều) ──────
WARD_DISTANCE_TIER = {
    "Ninh Kiều": 0,
    "Tân An": 1,
    "Cái Khế": 1,
    "Bình Thủy": 2,
    "Cái Răng": 3,
    "Long Tuyền": 4,
    "An Bình": 4,
    "Thới An Đông": 5,
}

# ── Feature names ─────────────────────────────────────
FEATURE_NAMES = [
    "ward_tier",        # Khoảng cách phường (0-3)
    "total_items",      # Tổng số lượng món
    "num_distinct",     # Số món khác nhau
    "order_hour",       # Giờ đặt hàng (6-22)
    "day_of_week",      # Ngày trong tuần (0=Mon, 6=Sun)
    "is_peak_hour",     # Giờ cao điểm (11-13, 17:30-20)
    "is_weekend",       # Cuối tuần (Sat/Sun)
    "subtotal",         # Giá trị đơn (VNĐ)
]

# ── Paths ─────────────────────────────────────────────
ML_DIR = Path(__file__).resolve().parent
DATA_DIR = ML_DIR / "data"
MODEL_DIR = ML_DIR / "models"
