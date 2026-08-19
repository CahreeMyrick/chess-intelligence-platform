"""
Chess.com public API client. Mirrors fetchJsonWithTimeout / getRecentGames.
"""
import httpx

USER_AGENT = "Mozilla/5.0 (compatible; IchigoChessApp/1.0; +https://github.com/ichigo-chess)"


class ChessComError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


async def fetch_json(url: str, timeout_s: float = 5.0) -> dict:
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        r = await client.get(
            url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
        )
        if r.status_code >= 400:
            raise ChessComError(f"HTTP {r.status_code} for {url}", status=r.status_code)
        return r.json()


async def get_recent_games(username_raw: str, max_games: int = 15) -> dict:
    """Mirrors getRecentGames(): walks monthly archives newest-first until
    max_games games have been collected."""
    username = str(username_raw or "").strip().lower()
    if not username:
        raise ValueError("missing username")

    base = f"https://api.chess.com/pub/player/{username}"
    archives_json = await fetch_json(f"{base}/games/archives")
    archives = archives_json.get("archives") or []
    if not archives:
        return {"username": username, "archives": [], "games": []}

    games: list[dict] = []

    for month_url in reversed(archives):
        if len(games) >= max_games:
            break
        try:
            month_json = await fetch_json(month_url)
        except ChessComError:
            continue
        raw_games = month_json.get("games") or []
        if not raw_games:
            continue

        for g in reversed(raw_games):
            if len(games) >= max_games:
                break
            games.append(
                {
                    "id": len(games),
                    "url": g.get("url"),
                    "end_time": g.get("end_time"),
                    "time_control": g.get("time_control"),
                    "time_class": g.get("time_class"),
                    "rated": bool(g.get("rated")),
                    "white": {
                        "username": (g.get("white") or {}).get("username"),
                        "rating": (g.get("white") or {}).get("rating"),
                        "result": (g.get("white") or {}).get("result"),
                    },
                    "black": {
                        "username": (g.get("black") or {}).get("username"),
                        "rating": (g.get("black") or {}).get("rating"),
                        "result": (g.get("black") or {}).get("result"),
                    },
                    "pgn": g.get("pgn"),
                }
            )

    return {"username": username, "archives": archives, "games": games}
