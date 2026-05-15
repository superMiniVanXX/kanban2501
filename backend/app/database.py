# backend/app/database.py
import os
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "kanban.db")

SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema():
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(projects)"))]
        if "parent_id" not in cols:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN parent_id VARCHAR(36) REFERENCES projects(id) ON DELETE SET NULL"
            ))
            conn.commit()
        task_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "sub_project_id" not in task_cols:
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN sub_project_id VARCHAR(36) REFERENCES projects(id) ON DELETE SET NULL"
            ))
            conn.commit()
        if "acceptance_criteria" not in task_cols:
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT"
            ))
            conn.commit()
