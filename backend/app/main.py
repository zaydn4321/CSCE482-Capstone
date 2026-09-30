from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import Base, engine
from app.jobs import router as jobs
from app.routers import auth, export, locations, places, predict, profile, recommendations, visits


def create_app(*, create_tables: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if create_tables and settings.environment != "production":
            # Week 1: create_all. Alembic migrations take over once the schema stops moving.
            # Replit publishes the development schema to its managed production DB;
            # do not run schema-changing DDL at production startup.
            Base.metadata.create_all(engine)
        yield

    app = FastAPI(
        title="Orbit API",
        version="0.1.0",
        summary="Accounts, location ingest, visit detection and full export.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(locations.router)
    app.include_router(visits.router)
    app.include_router(jobs.router)
    app.include_router(places.router)
    app.include_router(profile.router)
    app.include_router(recommendations.router)
    app.include_router(predict.router)
    app.include_router(export.router)
    return app


app = create_app()
