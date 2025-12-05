#!/usr/bin/env python3
import os
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.ensemble import RandomForestClassifier
import joblib
import numpy as np

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
CSV_PATH = os.path.join(DATA_DIR, "puzzles_ml.csv")
MODEL_PATH = os.path.join(DATA_DIR, "puzzle_ranker.joblib")

def main():
    if not os.path.exists(CSV_PATH):
        raise SystemExit(f"CSV not found: {CSV_PATH} – run export_puzzles_for_ml.py first.")

    df = pd.read_csv(CSV_PATH)
    print(f"[data] loaded {len(df)} puzzles")

    feature_cols = [
        "pre_eval_cp",
        "best_eval_cp",
        "played_eval_cp",
        "eval_gap_cp",
        "heuristic_difficulty",
        "is_mate",
    ]

    df = df.dropna(subset=feature_cols + ["label_good"]).copy()
    X = df[feature_cols].values
    y = df["label_good"].values

    classes, counts = np.unique(y, return_counts=True)
    print(f"[data] class distribution label_good={dict(zip(classes, counts))}")

    if len(classes) < 2:
        print("[warn] Only one class present in labels – cannot meaningfully train a classifier.")
        print("       You need more puzzles and/or a labeling rule that produces both 0 and 1.")
        return

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )

    print(f"[train] train size={len(X_train)}, test size={len(X_test)}")

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=None,
        min_samples_split=4,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1,
    )

    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)

    print("\n[metrics] classification report:\n")
    print(classification_report(y_test, y_pred, digits=3))

    # Only compute ROC AUC if we truly have a binary classifier
    if len(clf.classes_) == 2:
        y_proba = clf.predict_proba(X_test)[:, 1]
        try:
            auc = roc_auc_score(y_test, y_proba)
            print(f"[metrics] ROC AUC: {auc:.3f}")
        except Exception as e:
            print(f"[metrics] ROC AUC failed: {e}")
    else:
        print(f"[metrics] ROC AUC skipped – clf.classes_={clf.classes_}")

    print("\n[model] feature importance:")
    for name, imp in sorted(zip(feature_cols, clf.feature_importances_), key=lambda t: -t[1]):
        print(f"  {name:20s} {imp: .4f}")

    os.makedirs(DATA_DIR, exist_ok=True)
    joblib.dump({"model": clf, "features": feature_cols}, MODEL_PATH)
    print(f"\n[save] model saved to {MODEL_PATH}")

if __name__ == "__main__":
    main()
