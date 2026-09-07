"""
Trích xuất dữ liệu huấn luyện từ PostgreSQL.

Chạy:  python extract_data.py
Output: data/training_data.csv
"""
import psycopg2
import pandas as pd
import numpy as np
from config import DB_CONFIG, WARD_DISTANCE_TIER, FEATURE_NAMES, DATA_DIR


SQL_TRAINING_DATA = """
WITH completed_times AS (
    -- Lấy thời điểm "pending" và "completed" của mỗi đơn
    SELECT
        osh_pending.order_id,
        osh_pending.created_at  AS pending_at,
        osh_completed.created_at AS completed_at
    FROM order_status_history osh_pending
    JOIN order_status_history osh_completed
        ON osh_completed.order_id = osh_pending.order_id
       AND osh_completed.to_status = 'completed'
    WHERE osh_pending.to_status = 'pending'
),
order_item_stats AS (
    -- Thống kê món theo đơn
    SELECT
        order_id,
        SUM(quantity)::int     AS total_items,
        COUNT(DISTINCT menu_item_id)::int AS num_distinct
    FROM order_items
    GROUP BY order_id
)
SELECT
    o.id                          AS order_id,
    o.delivery_ward_name          AS ward_name,
    o.subtotal,
    o.created_at                  AS order_created_at,
    ois.total_items,
    ois.num_distinct,
    EXTRACT(EPOCH FROM (ct.completed_at - ct.pending_at)) / 60.0
                                  AS delivery_minutes
FROM orders o
JOIN completed_times ct        ON ct.order_id = o.id
JOIN order_item_stats ois      ON ois.order_id = o.id
WHERE o.status = 'completed'
  AND ct.completed_at > ct.pending_at
ORDER BY o.id;
"""


def extract_features(df: pd.DataFrame) -> pd.DataFrame:
    """Trích xuất features từ raw data."""
    df = df.copy()

    # Ward tier
    df["ward_tier"] = df["ward_name"].map(WARD_DISTANCE_TIER).fillna(2).astype(int)

    # Thời gian
    df["order_hour"] = df["order_created_at"].dt.hour
    df["day_of_week"] = df["order_created_at"].dt.dayofweek  # 0=Mon

    # Giờ cao điểm: 11-13h (trưa), 17:30-20h (tối)
    hour_frac = df["order_hour"] + df["order_created_at"].dt.minute / 60
    df["is_peak_hour"] = (
        ((hour_frac >= 11) & (hour_frac <= 13)) |
        ((hour_frac >= 17.5) & (hour_frac <= 20))
    ).astype(int)

    # Cuối tuần
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

    return df


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Kết nối DB...")
    conn = psycopg2.connect(**DB_CONFIG)

    print("Truy vấn dữ liệu...")
    df = pd.read_sql(SQL_TRAINING_DATA, conn)
    conn.close()

    print(f"  Số đơn completed: {len(df)}")

    if len(df) == 0:
        print("Không có dữ liệu để trích xuất!")
        return

    # Trích xuất features
    df = extract_features(df)

    # Lọc outlier (delivery > 180 phút = bất thường)
    before = len(df)
    df = df[df["delivery_minutes"].between(5, 180)]
    removed = before - len(df)
    if removed > 0:
        print(f"  Loại bỏ {removed} outlier (delivery < 5 hoặc > 180 phút)")

    # Lưu full data
    output_cols = FEATURE_NAMES + ["delivery_minutes", "order_id", "ward_name"]
    df[output_cols].to_csv(DATA_DIR / "training_data.csv", index=False)

    # Thống kê
    print(f"\n{'='*50}")
    print(f"Tổng mẫu huấn luyện: {len(df)}")
    print(f"\nThống kê delivery_minutes:")
    print(df["delivery_minutes"].describe().to_string())
    print(f"\nPhân bố theo phường:")
    ward_stats = df.groupby("ward_name")["delivery_minutes"].agg(["count", "mean", "std", "min", "max"])
    ward_stats.columns = ["Số đơn", "TB (phút)", "Std", "Min", "Max"]
    print(ward_stats.round(1).to_string())
    print(f"\nĐã lưu: {DATA_DIR / 'training_data.csv'}")


if __name__ == "__main__":
    main()
