"""
backend/main.py
QueryDesk v3 — FastAPI application entry point.

Run locally:
    uvicorn backend.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from backend.config import get_settings
from backend.db import get_engine
from backend.limiter import limiter
from backend.routers import auth, courses, queries


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up DB connection pool on startup
    engine = get_engine()
    async with engine.connect():
        pass
    yield
    # Dispose pool on shutdown
    await engine.dispose()


settings = get_settings()

# ── Rate limiter ──────────────────────────────────────────────────────────────
# limiter is imported from backend.limiter (shared instance)

app = FastAPI(
    title="QueryDesk API",
    version="3.0.0",
    description="Central backend for QueryDesk — multi-course student query management.",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(courses.router)
app.include_router(queries.router)


# ── Health check (real DB ping) ───────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health(request: Request):
    db_ok = False
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy", fromlist=["text"]).text("SELECT 1"))
        db_ok = True
    except Exception:
        pass
    return {"status": "ok" if db_ok else "degraded", "db": db_ok, "version": "3.0.0"}
