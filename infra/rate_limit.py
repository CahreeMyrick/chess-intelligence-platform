"""
Shared rate limiter. Mirrors the express-rate-limit config on /bestmove:
30 requests / 60s window, keyed by client IP (req.ip, with `trust proxy`
respected since FastAPI/uvicorn behind a proxy needs X-Forwarded-For handling
too — see main.py's ProxyHeadersMiddleware).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
