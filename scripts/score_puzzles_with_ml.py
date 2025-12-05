#!/usr/bin/env python3
"""
Use the trained model to score all puzzles and write ml_score into the DB.
"""

import os
import sqlite3
import numpy as np
import joblib

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
DB_PATH  = os.path.join(DATA_DIR, "app.db")
MODEL_PATH = os.path.join(DATA_DIR, "puzzle_ranker.joblib")

def main():
    if not os.path.exists(DB_PATH):
        raise SystemExit(f"DB not found: {DB_PATH}")
    if not os.path.exists(MODEL_PATH):
        raise SystemExit(f"Model not found: {MODEL_PATH} – run train_puzzle_ranker.py first.")

    print(f"[init] DB: {DB_PATH}")
    print(f"[init] model: {MODEL_PATH}")

    bundle = joblib.load(MODEL_PATH)
    clf = bundle["model"]
    feature_cols = bundle["features"]

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Ensure ml_score column exists (ignore if already there)
    try:
        cur.execute("ALTER TABLE puzzles ADD COLUMN ml_score REAL;")
        conn.commit()
        print("[schema] added ml_score column")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("[schema] ml_score already exists")
        else:
            raise

    # Pull all puzzles + feature columns
    cols_sql = ", ".join(feature_cols)
    cur.execute(f"""
        SELECT id, {cols_sql}
        FROM puzzles
    """)
    rows = cur.fetchall()
    print(f"[data] scoring {len(rows)} puzzles")

    # Check model is binary
    if len(getattr(clf, "classes_", [])) != 2:
        print(f"[warn] model.classes_ = {getattr(clf, 'classes_', None)} – not binary, aborting.")
        return

    updated = 0
    for r in rows:
        id_ = r["id"]
        feat_vals = [r[name] for name in feature_cols]

        if any(v is None for v in feat_vals):
            # skip puzzles with missing features
            continue

        X = np.array(feat_vals, dtype=float).reshape(1, -1)
        proba_good = float(clf.predict_proba(X)[0, 1])

        cur.execute(
            "UPDATE puzzles SET ml_score = ? WHERE id = ?",
            (proba_good, id_)
        )
        updated += 1

    conn.commit()
    conn.close()
    print(f"[done] updated ml_score for {updated} puzzles")

if __name__ == "__main__":
    main()
