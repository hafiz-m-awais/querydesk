"""
backend/limiter.py
Shared slowapi Limiter instance — import this in main.py and in routers.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import get_settings

_settings = get_settings()

limiter = Limiter(
    key_func=get_remote_address,
    enabled=_settings.rate_limit_enabled,
)
