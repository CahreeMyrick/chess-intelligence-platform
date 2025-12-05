#!/usr/bin/env python3
"""
Read a JSON list of puzzles from stdin, add ml_score using puzzle_ranker.joblib,
and write the updated list to stdout as JSON.

Each input puzzle must have the features used in training:
  pre_eval_cp, best_eval_cp, played_eval_cp, eval_gap_cp,
  heuristic_difficulty, is_mate
"""

import os
import sys
import json
import numpy as np
import joblib

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
MODEL_PATH = os.path.join(DATA_DIR, "puzzle_ranker.joblib")


def main():
    if not os.path.exists(MODEL_PATH):
        print(f"Model not found at {MODEL_PATH}", file=sys.stderr)
        sys.exit(1)

    raw = sys.stdin.read()
    if not raw.strip():
        print("No input puzzles", file=sys.stderr)
        sys.exit(1)

    try:
        puzzles = json.loads(raw)
    except Exception as e:
        print(f"Failed to parse JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(puzzles, list):
        print("Input must be a JSON list", file=sys.stderr)
        sys.exit(1)

    bundle = joblib.load(MODEL_PATH)
    clf = bundle["model"]
    feature_cols = bundle["features"]

    if len(getattr(clf, "classes_", [])) != 2:
        print(f"Model classes = {getattr(clf, 'classes_', None)}, expected 2", file=sys.stderr)
        sys.exit(1)

    X = []
    valid_idx = []

    for idx, p in enumerate(puzzles):
        try:
            row = [float(p.get(col, 0.0)) for col in feature_cols]
        except Exception:
            continue
        X.append(row)
        valid_idx.append(idx)

    if not X:
        for p in puzzles:
            p["ml_score"] = 0.0
        print(json.dumps(puzzles))
        return

    X = np.array(X, dtype=float)
    proba = clf.predict_proba(X)[:, 1]  # P(label_good=1)

    for idx, score in zip(valid_idx, proba):
        puzzles[idx]["ml_score"] = float(score)

    for p in puzzles:
        if "ml_score" not in p:
            p["ml_score"] = 0.0

    print(json.dumps(puzzles))


if __name__ == "__main__":
    main()
