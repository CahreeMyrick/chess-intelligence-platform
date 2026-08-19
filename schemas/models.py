from typing import Optional, Any
from pydantic import BaseModel, Field


class BookMoveRequest(BaseModel):
    moves: list[str] = Field(default_factory=list)


class BestMoveRequest(BaseModel):
    fen: Optional[str] = None
    moves: list[str] = Field(default_factory=list)
    movetimeMs: int = 500
    depth: Optional[int] = None
    wtime: Optional[int] = None
    btime: Optional[int] = None
    winc: Optional[int] = None
    binc: Optional[int] = None


class PgnRequest(BaseModel):
    moves: list[str] = Field(default_factory=list)
    headers: dict = Field(default_factory=dict)
    result: str = "*"


class NewGameRequest(BaseModel):
    time_control: str = "5+0"


class GameMoveRequest(BaseModel):
    uci: str  # UCI move, e.g. "e2e4"


class FromGameRequest(BaseModel):
    pgn: str
    username: Optional[str] = None
    maxPuzzles: Optional[int] = None


class FromUserMlRequest(BaseModel):
    username: str
    maxGames: Optional[int] = None
    maxPuzzles: Optional[int] = None
    movetimeMs: Optional[int] = None
