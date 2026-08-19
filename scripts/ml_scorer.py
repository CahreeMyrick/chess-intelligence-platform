"""
Puzzle quality scorer.

The original Node app shelled out to a separate `score_puzzles_ad_hoc.py`
script (spawn + JSON over stdin/stdout) because Node can't run a scikit-learn
model itself. Since this whole backend is Python now, that subprocess hop is
unnecessary — this module exposes an in-process `score_puzzles()` function
that the puzzle routes call directly.

If you have the original trained model (e.g. a joblib-pickled
RandomForestClassifier used by score_puzzles_ad_hoc.py), drop it at
MODEL_PATH and this will load + use it automatically. Until then it falls
back to the same sigmoid-over-eval-gap heuristic the Node code used as its
own fallback, so behavior is at least equivalent to the "ML scoring failed"
path you already had.
"""
import logging
import math
from pathlib import Path
from typing import Any

from config.config import BASE_DIR

log = logging.getLogger("ml_scorer")

MODEL_PATH = BASE_DIR / "models" / "puzzle_scorer.joblib"

_model = None
_model_load_attempted = False

FEATURE_ORDER = [
    "pre_eval_cp",
    "best_eval_cp",
    "played_eval_cp",
    "eval_gap_cp",
    "heuristic_difficulty",
    "is_mate",
]


def _load_model():
    global _model, _model_load_attempted
    if _model_load_attempted:
        return _model
    _model_load_attempted = True
    if MODEL_PATH.exists():
        try:
            import joblib  # local import: optional dependency

            _model = joblib.load(MODEL_PATH)
            log.info("Loaded puzzle scoring model from %s", MODEL_PATH)
        except Exception as e:
            log.error("Failed to load puzzle scoring model: %s", e)
            _model = None
    return _model


def _sigmoid_fallback_score(puzzle: dict) -> float:
    gap = puzzle.get("eval_gap_cp") or 0
    return 1 / (1 + math.exp(-((gap - 100) / 100)))


def score_puzzles(puzzles: list[dict]) -> tuple[list[dict], bool]:
    """Score a list of puzzle dicts, returning (scored_puzzles, used_fallback).

    Mirrors scorePuzzlesWithPython() + the caller's fallback-on-failure logic
    in the original server.js (buildUserRecentPuzzlesML).
    """
    if not puzzles:
        return [], False

    model = _load_model()

    if model is not None:
        try:
            import numpy as np

            X = np.array(
                [[float(p.get(f) or 0) for f in FEATURE_ORDER] for p in puzzles]
            )
            # Assumes a classifier exposing predict_proba where column 1 is
            # "good puzzle" probability, matching a typical RF setup.
            probs = model.predict_proba(X)[:, 1]
            scored = [{**p, "ml_score": float(prob)} for p, prob in zip(puzzles, probs)]
            return scored, False
        except Exception as e:
            log.error("Model scoring failed, falling back to heuristic: %s", e)

    scored = [{**p, "ml_score": _sigmoid_fallback_score(p)} for p in puzzles]
    return scored, True
