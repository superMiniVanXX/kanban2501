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
        if "implementation_plan" not in task_cols:
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN implementation_plan TEXT"
            ))
            conn.commit()
        ec_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(execution_configs)"))]
        if not ec_cols:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS execution_configs ("
                "id VARCHAR(36) PRIMARY KEY, "
                "name VARCHAR(200) NOT NULL, "
                "command_template TEXT NOT NULL, "
                "description TEXT, "
                "created_at DATETIME, "
                "updated_at DATETIME"
                ")"
            ))
            conn.commit()
        al_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(activity_logs)"))]
        if not al_cols:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS activity_logs ("
                "id VARCHAR(36) PRIMARY KEY, "
                "project_id VARCHAR(36) NOT NULL, "
                "event_type VARCHAR(50) NOT NULL, "
                "entity_type VARCHAR(20) NOT NULL, "
                "entity_id VARCHAR(36) NOT NULL, "
                "entity_name VARCHAR(300) NOT NULL, "
                "detail TEXT NOT NULL, "
                "extra_data TEXT, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        trp_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(code_projects)"))]
        if not trp_cols:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS code_projects ("
                "id VARCHAR(36) PRIMARY KEY, "
                "name VARCHAR(200) NOT NULL, "
                "description TEXT, "
                "repo_url VARCHAR(500), "
                "path VARCHAR(1000), "
                "created_at DATETIME, "
                "updated_at DATETIME"
                ")"
            ))
            conn.commit()
        if "path" not in trp_cols:
            conn.execute(text("ALTER TABLE code_projects ADD COLUMN path VARCHAR(1000)"))
            conn.commit()
        tcp_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(task_code_projects)"))]
        if not tcp_cols:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS task_code_projects ("
                "task_id VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, "
                "code_project_id VARCHAR(36) NOT NULL REFERENCES code_projects(id) ON DELETE CASCADE, "
                "PRIMARY KEY (task_id, code_project_id)"
                ")"
            ))
            conn.commit()
        if "deleted_at" not in cols:
            conn.execute(text("ALTER TABLE projects ADD COLUMN deleted_at DATETIME"))
            conn.commit()
        if "deleted_at" not in task_cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN deleted_at DATETIME"))
            conn.commit()
        # Re-fetch cols/task_cols after potential modifications above
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(projects)"))]
        task_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "exclude_from_stats" not in cols:
            conn.execute(text("ALTER TABLE projects ADD COLUMN exclude_from_stats BOOLEAN DEFAULT 0"))
            conn.commit()
        if "exclude_from_stats" not in task_cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN exclude_from_stats BOOLEAN DEFAULT 0"))
            conn.commit()
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_code_projects_path "
            "ON code_projects(path) WHERE path IS NOT NULL"
        ))
        conn.commit()
        tsh_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(task_status_history)"))]
        if not tsh_cols:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS task_status_history ("
                "id VARCHAR(36) PRIMARY KEY, "
                "task_id VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, "
                "project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
                "old_status VARCHAR(20) NOT NULL, "
                "new_status VARCHAR(20) NOT NULL, "
                "old_progress INTEGER NOT NULL, "
                "new_progress INTEGER NOT NULL, "
                "changed_at DATETIME NOT NULL"
                ")"
            ))
            conn.commit()
        wtc_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(worktree_configs)"))]
        if not wtc_cols:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS worktree_configs ("
                "id VARCHAR(36) PRIMARY KEY, "
                "name VARCHAR(200) NOT NULL, "
                "description TEXT, "
                "branch_template VARCHAR(500) NOT NULL, "
                "dir_template VARCHAR(500) NOT NULL, "
                "auto_cleanup BOOLEAN DEFAULT 0, "
                "base_repo_path VARCHAR(1000) NOT NULL, "
                "created_at DATETIME, "
                "updated_at DATETIME"
                ")"
            ))
            conn.commit()
