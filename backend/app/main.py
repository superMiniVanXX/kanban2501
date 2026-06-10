# backend/app/main.py
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import ensure_schema
from app.routers import projects, tasks, board, execution_configs, activity, code_projects, statistics, trash, worktree_configs, worktrees

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_schema()
    yield


app = FastAPI(title="Kanban-PMP", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(board.router, prefix="/api/v1")
app.include_router(execution_configs.router, prefix="/api/v1")
app.include_router(activity.router, prefix="/api/v1")
app.include_router(code_projects.router, prefix="/api/v1")
app.include_router(statistics.router, prefix="/api/v1")
app.include_router(trash.router, prefix="/api/v1")
app.include_router(worktree_configs.router, prefix="/api/v1")
app.include_router(worktrees.router, prefix="/api/v1")

static_dir = Path(__file__).resolve().parent.parent / "static"
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
