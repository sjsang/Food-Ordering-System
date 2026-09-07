"""
Module dự đoán thời gian giao hàng.

Sử dụng:
    from predict import DeliveryPredictor
    predictor = DeliveryPredictor()
    result = predictor.predict(ward_name="Cái Khế", total_items=3,
                                num_distinct=2, order_hour=12,
                                subtotal=150000)
"""
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import joblib

from config import WARD_DISTANCE_TIER, FEATURE_NAMES, MODEL_DIR


class DeliveryPredictor:
    """Load trained model và dự đoán thời gian giao hàng."""

    def __init__(self, model_dir: Path = MODEL_DIR):
        model_path = model_dir / "best_model.joblib"
        info_path = model_dir / "model_info.json"

        if not model_path.exists():
            raise FileNotFoundError(f"Chưa train model! Chạy: python train.py")

        self.model = joblib.load(model_path)
        with open(info_path, "r", encoding="utf-8") as f:
            self.info = json.load(f)

    def predict(
        self,
        ward_name: str,
        total_items: int,
        num_distinct: int,
        order_hour: int = None,
        day_of_week: int = None,
        subtotal: float = 0,
    ) -> dict:
        """
        Dự đoán thời gian giao hàng.

        Args:
            ward_name: Tên phường giao hàng
            total_items: Tổng số lượng món
            num_distinct: Số món khác nhau
            order_hour: Giờ đặt hàng (mặc định: giờ hiện tại)
            day_of_week: Ngày trong tuần 0=Mon (mặc định: hôm nay)
            subtotal: Giá trị đơn hàng

        Returns:
            dict với estimated_minutes và confidence
        """
        now = datetime.now()
        if order_hour is None:
            order_hour = now.hour
        if day_of_week is None:
            day_of_week = now.weekday()

        ward_tier = WARD_DISTANCE_TIER.get(ward_name, 2)
        hour_frac = order_hour
        is_peak = int((11 <= hour_frac <= 13) or (17.5 <= hour_frac <= 20))
        is_weekend = int(day_of_week >= 5)

        features = np.array([[
            ward_tier,
            total_items,
            num_distinct,
            order_hour,
            day_of_week,
            is_peak,
            is_weekend,
            subtotal,
        ]])

        predicted = self.model.predict(features)[0]
        predicted = max(10, round(predicted))  # tối thiểu 10 phút

        # Confidence dựa vào MAE của model
        mae = self.info.get("mae_minutes", 10)
        if mae <= 5:
            confidence = "high"
        elif mae <= 10:
            confidence = "medium"
        else:
            confidence = "low"

        return {
            "estimated_minutes": predicted,
            "confidence": confidence,
            "model": self.info.get("algorithm"),
            "mae": mae,
        }


def main():
    """Demo dự đoán."""
    predictor = DeliveryPredictor()
    print(f"Model: {predictor.info['algorithm']}")
    print(f"MAE:   {predictor.info['mae_minutes']} phút")
    print(f"R²:    {predictor.info['r2_score']}")
    print()

    test_cases = [
        {"ward_name": "Ninh Kiều", "total_items": 2, "num_distinct": 2, "order_hour": 10, "subtotal": 80000},
        {"ward_name": "Cái Khế",   "total_items": 3, "num_distinct": 2, "order_hour": 12, "subtotal": 150000},
        {"ward_name": "Bình Thủy", "total_items": 5, "num_distinct": 4, "order_hour": 18, "subtotal": 250000},
        {"ward_name": "An Bình",   "total_items": 4, "num_distinct": 3, "order_hour": 19, "subtotal": 200000},
        {"ward_name": "Thới An Đông", "total_items": 6, "num_distinct": 5, "order_hour": 12, "subtotal": 350000},
    ]

    print(f"{'Phường':<16} {'Số món':>6} {'Giờ':>4} {'Dự đoán':>10} {'Confidence':<10}")
    print("-" * 55)
    for tc in test_cases:
        result = predictor.predict(**tc)
        print(f"{tc['ward_name']:<16} {tc['total_items']:>6} {tc['order_hour']:>4}h "
              f"{result['estimated_minutes']:>7} phút  {result['confidence']:<10}")


if __name__ == "__main__":
    main()
