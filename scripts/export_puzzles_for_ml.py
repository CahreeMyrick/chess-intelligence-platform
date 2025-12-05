#!/usr/bin/env python3
"""
Export puzzles from data/app.db into a CSV for ML training.

Usage:
    python scripts/export_puzzles_for_ml.py
"""

import os
import sqlite3
import csv
from datetime import datetime

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
DB_PATH  = os.path.join(DATA_DIR, "app.db")
OUT_CSV  = os.path.join(DATA_DIR, "puzzles_ml.csv")

os.makedirs(DATA_DIR, exist_ok=True)

def main():
    print(f"[init] DB: {DB_PATH}")
    if not os.path.exists(DB_PATH):
        raise SystemExit("DB not found – run the puzzle generator first.")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Pull all puzzles (or limit if you want)
    cur.execute("""
        SELECT
          id,
          fen,
          side_to_move,
          solution_moves,
          pre_eval_cp,
          best_eval_cp,
          played_eval_cp,
          eval_gap_cp,
          heuristic_difficulty,
          is_mate,
          source_game,
          created_at
        FROM puzzles
        ORDER BY id ASC
    """)

    rows = cur.fetchall()
    if not rows:
        raise SystemExit("No puzzles in DB yet – run the generator first.")

    # Define CSV columns
    fieldnames = [
        "id",
        "fen",
        "side_to_move",
        "solution_moves",
        "pre_eval_cp",
        "best_eval_cp",
        "played_eval_cp",
        "eval_gap_cp",
        "heuristic_difficulty",
        "is_mate",
        "source_game",
        "created_at",
        # Synthetic label for now (we'll improve later)
        "label_good",
    ]

    print(f"[export] Writing {len(rows)} puzzles → {OUT_CSV}")
    with open(OUT_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for r in rows:
            pre   = r["pre_eval_cp"]
            best  = r["best_eval_cp"]
            played= r["played_eval_cp"]
            gap   = r["eval_gap_cp"]

            # SIMPLE PROXY LABEL (we'll replace this with user feedback later):
            # call it "good" if the gap is big and the best move leads to a clearly better position.
            label_good = 1 if (gap is not None and gap >= 200 and best is not None and best >= 200) else 0

            writer.writerow({
                "id": r["id"],
                "fen": r["fen"],
                "side_to_move": r["side_to_move"],
                "solution_moves": r["solution_moves"],
                "pre_eval_cp": pre,
                "best_eval_cp": best,
                "played_eval_cp": played,
                "eval_gap_cp": gap,
                "heuristic_difficulty": r["heuristic_difficulty"],
                "is_mate": r["is_mate"],
                "source_game": r["source_game"],
                "created_at": r["created_at"],
                "label_good": label_good,
            })

    print("[export] done.")

if __name__ == "__main__":
    main()
