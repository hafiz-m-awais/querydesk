"""
backend/main.py
QueryDesk v3 — FastAPI application entry point.

Run locally:
    cd backend
    uvicorn backend.main:app --reload --port 8000

Or from repo root:
    uvicorn backend.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_settings
from backend.db import get_engine
from backend.routers import auth, queries


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

app = FastAPI(
    title="QueryDesk API",
    version="3.0.0",
    description="Central backend for QueryDesk — multi-course student query management.",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

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
app.include_router(queries.router)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "version": "3.0.0"}
