"""
Huấn luyện & so sánh các thuật toán ML dự đoán thời gian giao hàng.

Chạy:  python train.py
Output:
  - Bảng so sánh các thuật toán (MAE, RMSE, R², thời gian train)
  - Biểu đồ so sánh → data/comparison.png
  - Model tốt nhất  → models/best_model.joblib + models/model_info.json
"""
import time
import json
import warnings

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from tabulate import tabulate
import joblib

from sklearn.model_selection import cross_validate, KFold
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import make_scorer, mean_absolute_error, root_mean_squared_error, r2_score

# ── Các thuật toán ──
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.tree import DecisionTreeRegressor
from sklearn.ensemble import RandomForestRegressor
from xgboost import XGBRegressor

from config import FEATURE_NAMES, DATA_DIR, MODEL_DIR

warnings.filterwarnings("ignore")

# ── Định nghĩa các model cần so sánh ─────────────────
def get_models():
    """Trả về dict {tên: pipeline} của các thuật toán cần so sánh."""
    return {
        "Linear Regression": Pipeline([
            ("scaler", StandardScaler()),
            ("model", LinearRegression()),
        ]),
        "Ridge": Pipeline([
            ("scaler", StandardScaler()),
            ("model", Ridge(alpha=1.0)),
        ]),
        "Decision Tree": DecisionTreeRegressor(
            max_depth=6, min_samples_leaf=5, random_state=42
        ),
        "Random Forest": RandomForestRegressor(
            n_estimators=100, max_depth=8, min_samples_leaf=3, random_state=42
        ),
        "XGBoost": XGBRegressor(
            n_estimators=100, max_depth=4, learning_rate=0.1,
            min_child_weight=5, random_state=42, verbosity=0
        ),
    }


def evaluate_models(X, y, cv_folds=5):
    """
    Chạy cross-validation cho tất cả model.
    Trả về DataFrame kết quả.
    """
    models = get_models()
    kf = KFold(n_splits=cv_folds, shuffle=True, random_state=42)

    scoring = {
        "MAE": make_scorer(mean_absolute_error, greater_is_better=False),
        "RMSE": make_scorer(root_mean_squared_error, greater_is_better=False),
        "R2": "r2",
    }

    results = []

    for name, pipeline in models.items():
        print(f"  Training: {name}...", end=" ", flush=True)
        t0 = time.time()

        cv_results = cross_validate(
            pipeline, X, y,
            cv=kf,
            scoring=scoring,
            return_train_score=False,
        )

        elapsed = time.time() - t0

        results.append({
            "Thuật toán": name,
            "MAE (phút)": -cv_results["test_MAE"].mean(),
            "MAE Std": cv_results["test_MAE"].std(),
            "RMSE (phút)": -cv_results["test_RMSE"].mean(),
            "R²": cv_results["test_R2"].mean(),
            "R² Std": cv_results["test_R2"].std(),
            "Thời gian (s)": elapsed,
        })
        print(f"MAE={results[-1]['MAE (phút)']:.2f}, R²={results[-1]['R²']:.4f}, {elapsed:.2f}s")

    return pd.DataFrame(results).sort_values("MAE (phút)")


def plot_comparison(df_results):
    """Vẽ biểu đồ so sánh MAE và R² của các thuật toán."""
    fig, axes = plt.subplots(1, 2, figsize=(16, 6))

    df_sorted = df_results.sort_values("MAE (phút)")

    # ── MAE Chart ──
    ax1 = axes[0]
    colors = plt.cm.RdYlGn_r(np.linspace(0.2, 0.8, len(df_sorted)))
    bars = ax1.barh(df_sorted["Thuật toán"], df_sorted["MAE (phút)"], color=colors)
    ax1.set_xlabel("MAE (phút)")
    ax1.set_title("So sánh MAE — Mean Absolute Error (thấp = tốt)")
    ax1.invert_yaxis()
    for bar, val in zip(bars, df_sorted["MAE (phút)"]):
        ax1.text(bar.get_width() + 0.3, bar.get_y() + bar.get_height() / 2,
                 f"{val:.2f}", va="center", fontsize=9)

    # ── R² Chart ──
    ax2 = axes[1]
    df_r2 = df_results.sort_values("R²", ascending=True)
    colors2 = plt.cm.RdYlGn(np.linspace(0.2, 0.8, len(df_r2)))
    bars2 = ax2.barh(df_r2["Thuật toán"], df_r2["R²"], color=colors2)
    ax2.set_xlabel("R² Score")
    ax2.set_title("So sánh R² — Coefficient of Determination (cao = tốt)")
    ax2.set_xlim(min(0, df_r2["R²"].min() - 0.1), 1.05)
    for bar, val in zip(bars2, df_r2["R²"]):
        ax2.text(bar.get_width() + 0.01, bar.get_y() + bar.get_height() / 2,
                 f"{val:.4f}", va="center", fontsize=9)

    plt.tight_layout()
    out_path = DATA_DIR / "comparison.png"
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"\nBiểu đồ đã lưu: {out_path}")


def plot_feature_importance(model, feature_names):
    """Vẽ biểu đồ feature importance của model tốt nhất."""
    # Lấy model gốc nếu nó nằm trong Pipeline
    estimator = model
    if hasattr(model, "named_steps") and "model" in model.named_steps:
        estimator = model.named_steps["model"]

    if not hasattr(estimator, "feature_importances_"):
        print("  (Model không hỗ trợ feature importance)")
        return

    importance = estimator.feature_importances_
    idx = np.argsort(importance)

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.barh(range(len(idx)), importance[idx], color="steelblue")
    ax.set_yticks(range(len(idx)))
    ax.set_yticklabels([feature_names[i] for i in idx])
    ax.set_xlabel("Importance")
    ax.set_title("Feature Importance — Model tốt nhất")
    plt.tight_layout()

    out_path = DATA_DIR / "feature_importance.png"
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Feature importance đã lưu: {out_path}")


def train_best_model(X, y, df_results):
    """Train lại model tốt nhất trên toàn bộ dữ liệu và lưu."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    best_name = df_results.iloc[0]["Thuật toán"]
    best_mae = df_results.iloc[0]["MAE (phút)"]
    best_r2 = df_results.iloc[0]["R²"]

    print(f"\n{'='*50}")
    print(f"Model tốt nhất: {best_name}")
    print(f"  MAE = {best_mae:.2f} phút")
    print(f"  R²  = {best_r2:.4f}")

    # Lấy pipeline tương ứng và train trên full data
    models = get_models()
    best_pipeline = models[best_name]
    best_pipeline.fit(X, y)

    # Lưu model
    model_path = MODEL_DIR / "best_model.joblib"
    joblib.dump(best_pipeline, model_path)

    # Lưu thông tin model
    info = {
        "algorithm": best_name,
        "mae_minutes": round(best_mae, 2),
        "r2_score": round(best_r2, 4),
        "features": FEATURE_NAMES,
        "training_samples": len(X),
        "trained_at": pd.Timestamp.now().isoformat(),
    }
    info_path = MODEL_DIR / "model_info.json"
    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2, ensure_ascii=False)

    print(f"  Model đã lưu: {model_path}")
    print(f"  Thông tin:     {info_path}")

    # Feature importance
    plot_feature_importance(best_pipeline, FEATURE_NAMES)

    return best_pipeline, info


def main():
    # ── Load data ──
    csv_path = DATA_DIR / "training_data.csv"
    if not csv_path.exists():
        print(f"Chưa có dữ liệu! Chạy: python extract_data.py")
        return

    df = pd.read_csv(csv_path)
    print(f"Dữ liệu: {len(df)} mẫu, {len(FEATURE_NAMES)} features")

    X = df[FEATURE_NAMES].values
    y = df["delivery_minutes"].values

    # ── So sánh thuật toán ──
    print(f"\nĐánh giá {len(get_models())} thuật toán (5-Fold CV)...")
    print("-" * 50)
    df_results = evaluate_models(X, y, cv_folds=5)

    # ── Bảng kết quả ──
    print(f"\n{'='*50}")
    print("BẢNG SO SÁNH CÁC THUẬT TOÁN")
    print("=" * 50)
    display_cols = ["Thuật toán", "MAE (phút)", "RMSE (phút)", "R²", "Thời gian (s)"]
    table = df_results[display_cols].copy()
    table["MAE (phút)"] = table["MAE (phút)"].round(2)
    table["RMSE (phút)"] = table["RMSE (phút)"].round(2)
    table["R²"] = table["R²"].round(4)
    table["Thời gian (s)"] = table["Thời gian (s)"].round(3)
    print(tabulate(table, headers="keys", tablefmt="grid", showindex=False))

    # ── Biểu đồ ──
    plot_comparison(df_results)

    # ── Train & lưu model tốt nhất ──
    train_best_model(X, y, df_results)

    # ── Lưu bảng so sánh ──
    df_results.to_csv(DATA_DIR / "comparison_results.csv", index=False)
    print(f"\nBảng so sánh đã lưu: {DATA_DIR / 'comparison_results.csv'}")


if __name__ == "__main__":
    main()
