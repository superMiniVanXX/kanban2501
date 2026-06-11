# Git Worktree 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Kanban 任务增加 Git Worktree 集成，支持通过配置模板自动创建/清理独立的开发环境目录。

**Architecture:** 新增 `WorktreeConfig`（配置模板）和 `Worktree`（运行时实例）两个 ORM 模型。Task 通过可空外键 `worktree_id` 关联 Worktree。后端通过 `worktree_service.py` 封装 git 命令操作，状态变更钩子集成到现有 `change_task_status` 流程中。前端在 SettingsPage 新增配置管理，TaskCard/TaskDetailModal 展示 worktree 状态。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + SQLite（后端），React 18 + TypeScript + Tailwind CSS（前端），`subprocess` 执行 git 命令。

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `backend/app/models/worktree_config.py` | WorktreeConfig ORM 模型 |
| `backend/app/models/worktree.py` | Worktree ORM 模型 |
| `backend/app/schemas/worktree_config.py` | WorktreeConfig Pydantic schemas（Create/Update/Response） |
| `backend/app/schemas/worktree.py` | Worktree Pydantic schemas（WorktreeBrief/WorktreeResponse） |
| `backend/app/routers/worktree_configs.py` | WorktreeConfig CRUD 路由 |
| `backend/app/routers/worktrees.py` | Task Worktree 操作路由（POST/GET/PUT/DELETE） |
| `backend/app/services/worktree_service.py` | Git 操作封装（create/remove/validate/expand_template） |
| `backend/tests/test_worktree_service.py` | worktree_service 单元测试 |
| `backend/tests/test_worktree_api.py` | Worktree API 集成测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `backend/app/models/__init__.py` | 导入新模型 |
| `backend/app/models/task.py` | 新增 `worktree_id` 外键 + relationship |
| `backend/app/schemas/task.py` | TaskCreate/TaskUpdate 新增 `worktree_config_id`，TaskResponse 新增 `worktree` |
| `backend/app/routers/tasks.py` | create_task 处理 worktree_config_id，change_task_status 增加钩子，execute_task 优先使用 worktree.path |
| `backend/app/services/workflow_service.py` | 无修改（钩子逻辑直接在 router 中） |
| `backend/app/database.py` | ensure_schema 新增 worktree_configs/worktrees 建表和 task 加列 |
| `backend/app/main.py` | 注册新 router |
| `frontend/src/types/index.ts` | 新增 WorktreeConfig/Worktree/WorktreeConfigCreate 类型，Task 新增 worktree 字段，TaskCreate 新增 worktree_config_id |
| `frontend/src/services/api.ts` | 新增 worktree config CRUD + task worktree 操作 API 函数 |
| `frontend/src/pages/SettingsPage.tsx` | 新增 "Worktree 配置" tab |
| `frontend/src/components/TaskCard.tsx` | 新增 worktree 状态徽章 |
| `frontend/src/components/CreateTaskModal.tsx` | 新增 worktree_config_id 下拉框 |

---

### Task 1: WorktreeConfig 后端模型 + Schema + 迁移

**Files:**
- Create: `backend/app/models/worktree_config.py`
- Create: `backend/app/schemas/worktree_config.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: 创建 WorktreeConfig ORM 模型**

创建 `backend/app/models/worktree_config.py`：

```python
import uuid
from datetime import datetime
from sqlalchemy import Boolean, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WorktreeConfig(Base):
    __tablename__ = "worktree_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    branch_template: Mapped[str] = mapped_column(String(500), nullable=False)
    dir_template: Mapped[str] = mapped_column(String(500), nullable=False)
    auto_cleanup: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    base_repo_path: Mapped[str] = mapped_column(String(1000), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 2: 创建 WorktreeConfig Pydantic schemas**

创建 `backend/app/schemas/worktree_config.py`：

```python
from datetime import datetime
from pydantic import BaseModel, Field


class WorktreeConfigCreate(BaseModel):
    name: str = Field(max_length=200)
    branch_template: str = Field(max_length=500)
    dir_template: str = Field(max_length=500)
    base_repo_path: str = Field(max_length=1000)
    description: str | None = None
    auto_cleanup: bool = False


class WorktreeConfigUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    branch_template: str | None = Field(default=None, max_length=500)
    dir_template: str | None = Field(default=None, max_length=500)
    base_repo_path: str | None = Field(default=None, max_length=1000)
    description: str | None = None
    auto_cleanup: bool | None = None


class WorktreeConfigResponse(BaseModel):
    id: str
    name: str
    description: str | None
    branch_template: str
    dir_template: str
    auto_cleanup: bool
    base_repo_path: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: 在 `__init__.py` 中注册新模型**

在 `backend/app/models/__init__.py` 末尾添加：

```python
from app.models.worktree_config import WorktreeConfig
```

- [ ] **Step 4: 在 `ensure_schema` 中添加建表逻辑**

在 `backend/app/database.py` 的 `ensure_schema()` 末尾（最后一行 `conn.commit()` 之后）添加：

```python
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
```

- [ ] **Step 5: 提交**

```bash
git add backend/app/models/worktree_config.py backend/app/schemas/worktree_config.py backend/app/models/__init__.py backend/app/database.py
git commit -m "feat: add WorktreeConfig model, schema, and migration"
```

---

### Task 2: WorktreeConfig CRUD 路由

**Files:**
- Create: `backend/app/routers/worktree_configs.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 创建 WorktreeConfig CRUD 路由**

创建 `backend/app/routers/worktree_configs.py`：

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.worktree_config import WorktreeConfig
from app.schemas.worktree_config import (
    WorktreeConfigCreate,
    WorktreeConfigUpdate,
    WorktreeConfigResponse,
)

router = APIRouter(tags=["worktree-configs"])


@router.get("/worktree-configs", response_model=list[WorktreeConfigResponse])
def list_configs(db: Session = Depends(get_db)):
    return db.query(WorktreeConfig).order_by(WorktreeConfig.created_at.desc()).all()


@router.post("/worktree-configs", response_model=WorktreeConfigResponse, status_code=201)
def create_config(data: WorktreeConfigCreate, db: Session = Depends(get_db)):
    config = WorktreeConfig(**data.model_dump())
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.get("/worktree-configs/{config_id}", response_model=WorktreeConfigResponse)
def get_config(config_id: str, db: Session = Depends(get_db)):
    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")
    return config


@router.put("/worktree-configs/{config_id}", response_model=WorktreeConfigResponse)
def update_config(config_id: str, data: WorktreeConfigUpdate, db: Session = Depends(get_db)):
    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(config, k, v)
    db.commit()
    db.refresh(config)
    return config


@router.delete("/worktree-configs/{config_id}", status_code=204)
def delete_config(config_id: str, db: Session = Depends(get_db)):
    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")
    db.delete(config)
    db.commit()
```

- [ ] **Step 2: 在 main.py 中注册路由**

在 `backend/app/main.py` 中：

导入行（第 12 行）添加 `worktree_configs`：

```python
from app.routers import projects, tasks, board, execution_configs, activity, code_projects, statistics, trash, worktree_configs
```

在 `app.include_router(trash.router, prefix="/api/v1")` 之后添加：

```python
app.include_router(worktree_configs.router, prefix="/api/v1")
```

- [ ] **Step 3: 启动后端验证表自动创建**

Run: `cd backend && python -c "from app.main import app; print('OK')"`

- [ ] **Step 4: 提交**

```bash
git add backend/app/routers/worktree_configs.py backend/app/main.py
git commit -m "feat: add WorktreeConfig CRUD API routes"
```

---

### Task 3: Worktree 后端模型 + Schema + Task 关联

**Files:**
- Create: `backend/app/models/worktree.py`
- Create: `backend/app/schemas/worktree.py`
- Modify: `backend/app/models/task.py`
- Modify: `backend/app/schemas/task.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: 创建 Worktree ORM 模型**

创建 `backend/app/models/worktree.py`：

```python
import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Enum as SAEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Worktree(Base):
    __tablename__ = "worktrees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    config_id: Mapped[str] = mapped_column(String(36), ForeignKey("worktree_configs.id", ondelete="SET NULL"), nullable=True)
    branch: Mapped[str] = mapped_column(String(500), nullable=False)
    path: Mapped[str] = mapped_column(String(1000), nullable=False)
    status: Mapped[str] = mapped_column(
        SAEnum("pending", "active", "removed", "error", name="worktree_status"),
        default="pending",
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    task = relationship("Task", back_populates="worktree")
    config = relationship("WorktreeConfig")
```

- [ ] **Step 2: 在 `__init__.py` 中注册 Worktree 模型**

在 `backend/app/models/__init__.py` 末尾添加：

```python
from app.models.worktree import Worktree
```

- [ ] **Step 3: Task 模型添加 worktree 外键**

在 `backend/app/models/task.py` 的 `Task` 类中，在 `deleted_at` 之后添加：

```python
    worktree_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("worktrees.id", ondelete="SET NULL"), nullable=True)

    worktree = relationship("Worktree", back_populates="task", foreign_keys=[worktree_id])
```



- [ ] **Step 4: 创建 Worktree Pydantic schemas**

创建 `backend/app/schemas/worktree.py`：

```python
from datetime import datetime
from pydantic import BaseModel


class WorktreeBrief(BaseModel):
    id: str
    branch: str
    path: str
    status: str

    model_config = {"from_attributes": True}


class WorktreeResponse(BaseModel):
    id: str
    task_id: str
    config_id: str | None
    branch: str
    path: str
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorktreeCreateRequest(BaseModel):
    config_id: str
```

- [ ] **Step 5: 更新 Task schemas**

在 `backend/app/schemas/task.py` 中：

顶部添加导入：
```python
from app.schemas.worktree import WorktreeBrief
```

在 `TaskCreate` 类中，在 `exclude_from_stats` 之后添加：
```python
    worktree_config_id: str | None = None
```

在 `TaskUpdate` 类中，在 `exclude_from_stats` 之后添加：
```python
    worktree_config_id: str | None = None
```

在 `TaskResponse` 类中，在 `code_projects` 之后添加：
```python
    worktree: WorktreeBrief | None = None
```

- [ ] **Step 6: ensure_schema 添加 worktrees 建表和 task.worktree_id 列**

在 `backend/app/database.py` 的 `ensure_schema()` 末尾追加：

```python
        wt_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(worktrees)"))]
        if not wt_cols:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS worktrees ("
                "id VARCHAR(36) PRIMARY KEY, "
                "task_id VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, "
                "config_id VARCHAR(36) REFERENCES worktree_configs(id) ON DELETE SET NULL, "
                "branch VARCHAR(500) NOT NULL, "
                "path VARCHAR(1000) NOT NULL, "
                "status VARCHAR(20) DEFAULT 'pending', "
                "error_message TEXT, "
                "created_at DATETIME, "
                "updated_at DATETIME"
                ")"
            ))
            conn.commit()
        task_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "worktree_id" not in task_cols:
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN worktree_id VARCHAR(36) REFERENCES worktrees(id) ON DELETE SET NULL"
            ))
            conn.commit()
```

- [ ] **Step 7: 验证导入无误**

Run: `cd backend && python -c "from app.main import app; print('OK')"`

- [ ] **Step 8: 提交**

```bash
git add backend/app/models/worktree.py backend/app/schemas/worktree.py backend/app/models/__init__.py backend/app/models/task.py backend/app/schemas/task.py backend/app/database.py
git commit -m "feat: add Worktree model, Task association, and schemas"
```

---

### Task 4: worktree_service — Git 操作服务

**Files:**
- Create: `backend/app/services/worktree_service.py`

- [ ] **Step 1: 创建 worktree_service.py**

创建 `backend/app/services/worktree_service.py`：

```python
import logging
import os
import re
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def expand_template(template: str, task, project, branch: str | None = None) -> str:
    """Expand template variables like {task_id}, {task_title_slug}, etc."""
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', task.title).strip('-').lower()[:60]
    variables = {
        "{task_id}": task.id,
        "{task_id_short}": task.id[:8],
        "{task_title}": task.title,
        "{task_title_slug}": slug,
        "{task_type}": task.task_type or "",
        "{task_priority}": task.priority or "",
        "{task_assignee}": task.assignee or "",
        "{project_id}": project.id,
        "{project_name}": project.name,
    }
    if branch:
        variables["{branch_name}"] = branch
    result = template
    for token, value in variables.items():
        result = result.replace(token, value)
    return result


def validate_repo(path: str) -> dict:
    """Check if path is a valid git repository."""
    result = {"valid": False, "error": None}
    try:
        completed = subprocess.run(
            ["git", "-C", path, "rev-parse", "--git-dir"],
            capture_output=True, text=True, timeout=5,
        )
        if completed.returncode == 0:
            result["valid"] = True
        else:
            result["error"] = f"Not a git repository: {completed.stderr.strip()}"
    except FileNotFoundError:
        result["error"] = "git command not found"
    except subprocess.TimeoutExpired:
        result["error"] = "git command timed out"
    except Exception as e:
        result["error"] = str(e)
    return result


def create_worktree(base_repo: str, branch: str, target_path: str) -> dict:
    """Execute git worktree add -b <branch> <target_path> from base_repo.

    Returns {"success": bool, "error": str | None}
    """
    base = Path(base_repo).resolve()
    target = Path(target_path).resolve()

    # Security: target must not be inside base repo
    try:
        target.relative_to(base)
        return {"success": False, "error": f"Target path '{target}' is inside the base repository '{base}'"}
    except ValueError:
        pass

    # Check target doesn't exist
    if target.exists():
        return {"success": False, "error": f"Target path already exists: {target}"}

    # Ensure parent directory exists
    target.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = subprocess.run(
            ["git", "-C", str(base), "worktree", "add", "-b", branch, str(target)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            logger.info("Created worktree: branch=%s path=%s", branch, target)
            return {"success": True, "error": None}
        else:
            error = result.stderr.strip() or result.stdout.strip()
            logger.warning("git worktree add failed: %s", error)
            return {"success": False, "error": error}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "git worktree add timed out after 10 seconds"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def remove_worktree(path: str) -> dict:
    """Execute git worktree remove for the given path.

    Returns {"success": bool, "error": str | None}
    """
    target = Path(path).resolve()

    try:
        result = subprocess.run(
            ["git", "worktree", "remove", str(target)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            logger.info("Removed worktree: path=%s", target)
            return {"success": True, "error": None}
        else:
            error = result.stderr.strip() or result.stdout.strip()
            logger.warning("git worktree remove failed: %s", error)
            return {"success": False, "error": error}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "git worktree remove timed out after 10 seconds"}
    except Exception as e:
        return {"success": False, "error": str(e)}
```

- [ ] **Step 2: 提交**

```bash
git add backend/app/services/worktree_service.py
git commit -m "feat: add worktree_service with git operations and template expansion"
```

---

### Task 5: Worktree API 路由 + Task 集成钩子

**Files:**
- Create: `backend/app/routers/worktrees.py`
- Modify: `backend/app/routers/tasks.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 创建 Worktree 操作路由**

创建 `backend/app/routers/worktrees.py`：

```python
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.task import Task
from app.models.worktree import Worktree
from app.models.worktree_config import WorktreeConfig
from app.schemas.worktree import WorktreeResponse, WorktreeCreateRequest
from app.services.worktree_service import expand_template, validate_repo, create_worktree, remove_worktree

logger = logging.getLogger(__name__)

router = APIRouter(tags=["worktrees"])


def _get_task_or_404(task_id: str, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _do_create_worktree(task: Task, config: WorktreeConfig, db: Session) -> Worktree:
    """Expand templates and execute git worktree add."""
    project = task.project

    branch = expand_template(config.branch_template, task, project)
    path = expand_template(config.dir_template, task, project, branch=branch)

    # Validate base repo
    repo_check = validate_repo(config.base_repo_path)
    if not repo_check["valid"]:
        raise HTTPException(status_code=422, detail=f"Invalid base repository: {repo_check['error']}")

    # Create worktree
    result = create_worktree(config.base_repo_path, branch, path)

    if result["success"]:
        wt = Worktree(
            task_id=task.id,
            config_id=config.id,
            branch=branch,
            path=path,
            status="active",
        )
    else:
        wt = Worktree(
            task_id=task.id,
            config_id=config.id,
            branch=branch,
            path=path,
            status="error",
            error_message=result["error"],
        )

    db.add(wt)
    db.flush()
    task.worktree_id = wt.id
    db.commit()
    db.refresh(wt)
    return wt


@router.post("/tasks/{task_id}/worktree", response_model=WorktreeResponse, status_code=201)
def create_task_worktree(task_id: str, data: WorktreeCreateRequest, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)

    if task.worktree and task.worktree.status == "active":
        raise HTTPException(status_code=409, detail="Task already has an active worktree. Use PUT to rebuild.")

    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == data.config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")

    wt = _do_create_worktree(task, config, db)
    if wt.status == "error":
        raise HTTPException(status_code=500, detail=f"Worktree creation failed: {wt.error_message}")
    return wt


@router.get("/tasks/{task_id}/worktree", response_model=WorktreeResponse)
def get_task_worktree(task_id: str, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)
    if not task.worktree:
        raise HTTPException(status_code=404, detail="Task has no worktree")
    return task.worktree


@router.put("/tasks/{task_id}/worktree", response_model=WorktreeResponse)
def rebuild_task_worktree(task_id: str, data: WorktreeCreateRequest, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)

    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == data.config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")

    # Remove existing worktree if active
    if task.worktree and task.worktree.status == "active":
        result = remove_worktree(task.worktree.path)
        if result["success"]:
            task.worktree.status = "removed"
            db.commit()
        else:
            # Log but don't block — mark error and continue
            task.worktree.status = "error"
            task.worktree.error_message = f"Failed to remove old worktree: {result['error']}"
            db.commit()

    wt = _do_create_worktree(task, config, db)
    if wt.status == "error":
        raise HTTPException(status_code=500, detail=f"Worktree creation failed: {wt.error_message}")
    return wt


@router.delete("/tasks/{task_id}/worktree", status_code=204)
def delete_task_worktree(task_id: str, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)
    if not task.worktree or task.worktree.status != "active":
        raise HTTPException(status_code=404, detail="Task has no active worktree")

    result = remove_worktree(task.worktree.path)
    if result["success"]:
        task.worktree.status = "removed"
        task.worktree_id = None
        db.commit()
    else:
        raise HTTPException(status_code=500, detail=f"Failed to remove worktree: {result['error']}")
```

- [ ] **Step 2: 修改 tasks.py — create_task 处理 worktree_config_id + change_task_status 钩子 + execute_task workdir 优先级**

在 `backend/app/routers/tasks.py` 中：

**2a.** 顶部新增导入：

```python
from app.models.worktree import Worktree
from app.models.worktree_config import WorktreeConfig
from app.services.worktree_service import expand_template, validate_repo, create_worktree, remove_worktree
```

**2b.** 修改 `create_task` 函数。在 `log_activity(...)` 之前，`return task` 之前插入处理 worktree_config_id 的逻辑：

```python
    # Handle worktree_config_id — create a pending Worktree record
    wt_config_id = task_data.pop("worktree_config_id", None)
    if wt_config_id:
        wt_config = db.query(WorktreeConfig).filter(WorktreeConfig.id == wt_config_id).first()
        if wt_config:
            project = db.query(Project).filter(Project.id == project_id).first()
            branch = expand_template(wt_config.branch_template, task, project)
            path = expand_template(wt_config.dir_template, task, project, branch=branch)
            wt = Worktree(
                task_id=task.id,
                config_id=wt_config.id,
                branch=branch,
                path=path,
                status="pending",
            )
            db.add(wt)
            db.flush()
            task.worktree_id = wt.id
```

同时，在函数开头 `task_data = data.model_dump()` 之后，要把 `worktree_config_id` 从 `task_data` 中 pop 出来，避免传给 Task 构造函数（Task 模型没有这个字段）。上面的 `wt_config_id = task_data.pop(...)` 已经处理了这个。

**2c.** 修改 `update_task` 函数。在 `update_data = data.model_dump(exclude_unset=True)` 之后添加：

```python
    worktree_config_id = update_data.pop("worktree_config_id", None)
```

在 `db.commit()` 之前，处理 worktree_config_id 变更（如果用户切换了配置）：

```python
    if worktree_config_id is not None:
        if task.worktree and task.worktree.status == "active":
            pass  # Don't auto-rebuild on config change, user must use PUT /worktree
        elif worktree_config_id:
            wt_config = db.query(WorktreeConfig).filter(WorktreeConfig.id == worktree_config_id).first()
            if wt_config:
                project = db.query(Project).filter(Project.id == task.project_id).first()
                branch = expand_template(wt_config.branch_template, task, project)
                path = expand_template(wt_config.dir_template, task, project, branch=branch)
                wt = Worktree(
                    task_id=task.id,
                    config_id=wt_config.id,
                    branch=branch,
                    path=path,
                    status="pending",
                )
                db.add(wt)
                db.flush()
                task.worktree_id = wt.id
```

**2d.** 修改 `change_task_status` 函数。在 `log_activity(...)` 之前添加 worktree 钩子：

```python
    # Worktree hooks
    if data.status == "in_progress" and task.worktree and task.worktree.status == "pending":
        wt_config = db.query(WorktreeConfig).filter(WorktreeConfig.id == task.worktree.config_id).first()
        if wt_config:
            repo_check = validate_repo(wt_config.base_repo_path)
            if repo_check["valid"]:
                result = create_worktree(wt_config.base_repo_path, task.worktree.branch, task.worktree.path)
                if result["success"]:
                    task.worktree.status = "active"
                else:
                    task.worktree.status = "error"
                    task.worktree.error_message = result["error"]

    if data.status in ("done", "cancelled") and task.worktree and task.worktree.status == "active":
        wt_config = db.query(WorktreeConfig).filter(WorktreeConfig.id == task.worktree.config_id).first()
        if wt_config and wt_config.auto_cleanup:
            result = remove_worktree(task.worktree.path)
            if result["success"]:
                task.worktree.status = "removed"
                task.worktree_id = None
            else:
                task.worktree.status = "error"
                task.worktree.error_message = result["error"]
```

**2e.** 修改 `execute_task` 中的 `##workdir##` 解析。找到：

```python
        workdir = task.code_projects[0].path
```

替换为：

```python
        if task.worktree and task.worktree.status == "active":
            workdir = task.worktree.path
        else:
            workdir = task.code_projects[0].path
```

- [ ] **Step 3: 在 main.py 中注册 worktrees 路由**

在 `backend/app/main.py` 的导入行添加 `worktrees`：

```python
from app.routers import projects, tasks, board, execution_configs, activity, code_projects, statistics, trash, worktree_configs, worktrees
```

在 `app.include_router(worktree_configs.router, prefix="/api/v1")` 之后添加：

```python
app.include_router(worktrees.router, prefix="/api/v1")
```

- [ ] **Step 4: 验证后端启动**

Run: `cd backend && python -c "from app.main import app; print('OK')"`

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/worktrees.py backend/app/routers/tasks.py backend/app/main.py
git commit -m "feat: add worktree API routes and task integration hooks"
```

---

### Task 6: 后端测试

**Files:**
- Create: `backend/tests/test_worktree_service.py`
- Create: `backend/tests/test_worktree_api.py`

- [ ] **Step 1: 创建 worktree_service 单元测试**

创建 `backend/tests/test_worktree_service.py`：

```python
from app.services.worktree_service import expand_template


class MockTask:
    def __init__(self):
        self.id = "abc12345-6789-def0-1234-567890abcdef"
        self.title = "Add worktree support"
        self.task_type = "task"
        self.priority = "high"
        self.assignee = "alice"


class MockProject:
    def __init__(self):
        self.id = "proj-001"
        self.name = "Kanban-PMP"


def test_expand_template_branch():
    task = MockTask()
    project = MockProject()
    result = expand_template("feature/{task_id_short}-{task_title_slug}", task, project)
    assert result == "feature/abc12345-add-worktree-support"


def test_expand_template_dir_with_branch():
    task = MockTask()
    project = MockProject()
    result = expand_template("/tmp/worktrees/{project_name}/{branch_name}", task, project, branch="feature/test")
    assert result == "/tmp/worktrees/Kanban-PMP/feature/test"


def test_expand_template_all_vars():
    task = MockTask()
    project = MockProject()
    template = "{task_id}/{task_title}/{task_type}/{task_priority}/{task_assignee}/{project_name}"
    result = expand_template(template, task, project)
    assert "abc12345-6789-def0-1234-567890abcdef" in result
    assert "Add worktree support" in result
    assert "task" in result
    assert "high" in result
    assert "alice" in result
    assert "Kanban-PMP" in result


def test_expand_template_special_chars_in_title():
    task = MockTask()
    task.title = "Fix: XSS & SQL injection!!!"
    project = MockProject()
    result = expand_template("{task_title_slug}", task, project)
    assert result == "fix-xss-sql-injection"
```

- [ ] **Step 2: 运行 service 测试**

Run: `cd backend && python -m pytest tests/test_worktree_service.py -v`
Expected: 4 tests PASS

- [ ] **Step 3: 创建 WorktreeConfig API 集成测试**

创建 `backend/tests/test_worktree_api.py`：

```python
import pytest


@pytest.fixture
def sample_project(client):
    resp = client.post("/api/v1/projects", json={"name": "Test Project"})
    return resp.json()


@pytest.fixture
def sample_task(client, sample_project):
    resp = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={"title": "Test Task"})
    return resp.json()


@pytest.fixture
def sample_wt_config(client):
    resp = client.post("/api/v1/worktree-configs", json={
        "name": "Feature Branch",
        "branch_template": "feature/{task_id_short}-{task_title_slug}",
        "dir_template": "/tmp/worktrees/{project_name}/{branch_name}",
        "base_repo_path": "/tmp/test-repo",
        "description": "Feature branch worktree config",
        "auto_cleanup": False,
    })
    return resp.json()


def test_create_worktree_config(client):
    resp = client.post("/api/v1/worktree-configs", json={
        "name": "Test Config",
        "branch_template": "feature/{task_id_short}",
        "dir_template": "/tmp/wt/{branch_name}",
        "base_repo_path": "/tmp/repo",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Config"
    assert data["auto_cleanup"] is False


def test_list_worktree_configs(client, sample_wt_config):
    resp = client.get("/api/v1/worktree-configs")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_update_worktree_config(client, sample_wt_config):
    resp = client.put(f"/api/v1/worktree-configs/{sample_wt_config['id']}", json={
        "name": "Updated Config",
        "auto_cleanup": True,
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Config"
    assert resp.json()["auto_cleanup"] is True


def test_delete_worktree_config(client, sample_wt_config):
    resp = client.delete(f"/api/v1/worktree-configs/{sample_wt_config['id']}")
    assert resp.status_code == 204


def test_create_task_with_worktree_config(client, sample_project, sample_wt_config):
    resp = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={
        "title": "Task with Worktree",
        "worktree_config_id": sample_wt_config["id"],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["worktree"] is not None
    assert data["worktree"]["status"] == "pending"


def test_task_response_includes_worktree_none(client, sample_task):
    # sample_task has no worktree
    assert sample_task["worktree"] is None


def test_worktree_config_not_found(client, sample_task):
    resp = client.post(f"/api/v1/tasks/{sample_task['id']}/worktree", json={
        "config_id": "nonexistent-id",
    })
    assert resp.status_code == 404
```

- [ ] **Step 4: 运行 API 测试**

Run: `cd backend && python -m pytest tests/test_worktree_api.py -v`
Expected: 7 tests PASS

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 6: 提交**

```bash
git add backend/tests/test_worktree_service.py backend/tests/test_worktree_api.py
git commit -m "test: add worktree service and API tests"
```

---

### Task 7: 前端类型 + API 客户端

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: 添加前端类型定义**

在 `frontend/src/types/index.ts` 中：

在 `ExecutionConfigCreate` 之后添加：

```typescript
export interface WorktreeConfig {
  id: string;
  name: string;
  description: string | null;
  branch_template: string;
  dir_template: string;
  auto_cleanup: boolean;
  base_repo_path: string;
  created_at: string;
  updated_at: string;
}

export type WorktreeConfigCreate = Pick<WorktreeConfig, 'name' | 'branch_template' | 'dir_template' | 'base_repo_path'> & {
  description?: string;
  auto_cleanup?: boolean;
};

export interface Worktree {
  id: string;
  task_id: string;
  config_id: string | null;
  branch: string;
  path: string;
  status: 'pending' | 'active' | 'removed' | 'error';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
```

在 `Task` interface 中，在 `code_projects` 之后添加：

```typescript
  worktree: Worktree | null;
```

在 `TaskCreate` type 中添加可选字段：

```typescript
  worktree_config_id?: string;
```

- [ ] **Step 2: 添加 API 客户端函数**

在 `frontend/src/services/api.ts` 中：

更新导入，添加新类型：

```typescript
import type { ..., WorktreeConfig, WorktreeConfigCreate, Worktree } from '../types';
```

在 `// Trash` 部分之前添加：

```typescript
// Worktree Configs
export const getWorktreeConfigs = () =>
  api.get<WorktreeConfig[]>('/worktree-configs').then((r) => r.data);

export const createWorktreeConfig = (data: WorktreeConfigCreate) =>
  api.post<WorktreeConfig>('/worktree-configs', data).then((r) => r.data);

export const updateWorktreeConfig = (id: string, data: Partial<WorktreeConfigCreate>) =>
  api.put<WorktreeConfig>(`/worktree-configs/${id}`, data).then((r) => r.data);

export const deleteWorktreeConfig = (id: string) =>
  api.delete(`/worktree-configs/${id}`);

// Task Worktree
export const createTaskWorktree = (taskId: string, configId: string) =>
  api.post<Worktree>(`/tasks/${taskId}/worktree`, { config_id: configId }).then((r) => r.data);

export const getTaskWorktree = (taskId: string) =>
  api.get<Worktree>(`/tasks/${taskId}/worktree`).then((r) => r.data);

export const rebuildTaskWorktree = (taskId: string, configId: string) =>
  api.put<Worktree>(`/tasks/${taskId}/worktree`, { config_id: configId }).then((r) => r.data);

export const deleteTaskWorktree = (taskId: string) =>
  api.delete(`/tasks/${taskId}/worktree`);
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: 提交**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add frontend WorktreeConfig/Worktree types and API client"
```

---

### Task 8: SettingsPage — Worktree 配置管理 Tab

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

- [ ] **Step 1: 在 SettingsPage 添加 Worktree 配置 tab**

在 `frontend/src/pages/SettingsPage.tsx` 中：

**1a.** 更新导入，添加 worktree 相关类型和 API：

```typescript
import type { ..., WorktreeConfig, WorktreeConfigCreate } from '../types';
import {
  ...,
  getWorktreeConfigs,
  createWorktreeConfig,
  updateWorktreeConfig,
  deleteWorktreeConfig,
} from '../services/api';
```

**1b.** 添加 `activeTab` 类型扩展为 `'execution' | 'projects' | 'worktree'`，并在组件中添加 worktree state：

```typescript
const [activeTab, setActiveTab] = useState<'execution' | 'projects' | 'worktree'>('execution');

// Worktree configs state
const [wtConfigs, setWtConfigs] = useState<WorktreeConfig[]>([]);
const [wtLoading, setWtLoading] = useState(false);
const [showWtForm, setShowWtForm] = useState(false);
const [editingWt, setEditingWt] = useState<WorktreeConfig | null>(null);
const [wtForm, setWtForm] = useState<WorktreeConfigCreate>({ name: '', branch_template: '', dir_template: '', base_repo_path: '', description: '', auto_cleanup: false });
const [wtSaving, setWtSaving] = useState(false);
```

**1c.** 添加 fetch/save/delete 处理函数（在现有 `handleDeleteProject` 之后）：

```typescript
const fetchWtConfigs = async () => {
    setWtLoading(true);
    setWtConfigs(await getWorktreeConfigs());
    setWtLoading(false);
  };

  useEffect(() => { if (activeTab === 'worktree') fetchWtConfigs(); }, [activeTab]);

  const resetWtForm = () => {
    setWtForm({ name: '', branch_template: '', dir_template: '', base_repo_path: '', description: '', auto_cleanup: false });
    setEditingWt(null);
    setShowWtForm(false);
  };

  const handleEditWt = (c: WorktreeConfig) => {
    setWtForm({
      name: c.name,
      branch_template: c.branch_template,
      dir_template: c.dir_template,
      base_repo_path: c.base_repo_path,
      description: c.description ?? '',
      auto_cleanup: c.auto_cleanup,
    });
    setEditingWt(c);
    setShowWtForm(true);
  };

  const handleSaveWt = async () => {
    if (!wtForm.name.trim() || !wtForm.branch_template.trim() || !wtForm.dir_template.trim() || !wtForm.base_repo_path.trim()) return;
    setWtSaving(true);
    if (editingWt) {
      await updateWorktreeConfig(editingWt.id, wtForm);
    } else {
      await createWorktreeConfig(wtForm);
    }
    setWtSaving(false);
    resetWtForm();
    await fetchWtConfigs();
  };

  const handleDeleteWt = async (id: string) => {
    await deleteWorktreeConfig(id);
    await fetchWtConfigs();
  };
```

**1d.** 在 tab 导航中添加 Worktree tab 按钮（在 Code Projects 按钮之后）：

```tsx
        <button
          onClick={() => setActiveTab('worktree')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'worktree'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >Worktree 配置</button>
```

**1e.** 在 Code Projects tab 内容之后，添加 Worktree tab 内容。参照现有 Execution Configs tab 的 UI 模式，包含：

- 模板变量参考面板（`{task_id}`, `{task_id_short}`, `{task_title}`, `{task_title_slug}`, `{task_type}`, `{task_priority}`, `{task_assignee}`, `{project_id}`, `{project_name}`, `{branch_name}`）
- 配置列表（name, branch_template, dir_template, auto_cleanup badge, base_repo_path）
- 新增/编辑表单
- 删除按钮

表单字段：Name, Branch Template, Dir Template, Base Repo Path, Description, Auto Cleanup toggle。

UI 细节与 ExecutionConfig tab 风格完全平行——使用相同的 `bg-white border border-gray-200 rounded-lg` 容器，相同的按钮样式。

- [ ] **Step 2: 验证前端编译**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "feat: add Worktree config management tab in SettingsPage"
```

---

### Task 9: TaskCard — Worktree 状态徽章

**Files:**
- Modify: `frontend/src/components/TaskCard.tsx`

- [ ] **Step 1: 在 TaskCard 中添加 worktree 状态徽章**

在 `frontend/src/components/TaskCard.tsx` 中，找到 code_projects 徽章渲染区域（约第 226 行 `{task.code_projects && ...}` 代码块之后），添加 worktree 状态徽章：

```tsx
        {task.worktree && task.worktree.status !== 'removed' && (
          <div className="flex items-center flex-wrap gap-1 mt-1.5">
            {task.worktree.status === 'pending' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Worktree 待创建
              </span>
            )}
            {task.worktree.status === 'active' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-green-50 text-green-700 border border-green-200 font-medium">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                {task.worktree.branch}
              </span>
            )}
            {task.worktree.status === 'error' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-red-50 text-red-700 border border-red-200 font-medium" title={task.worktree.error_message ?? ''}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                Worktree 错误
              </span>
            )}
          </div>
        )}
```

- [ ] **Step 2: 验证前端编译**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/TaskCard.tsx
git commit -m "feat: add worktree status badges to TaskCard"
```

---

### Task 10: CreateTaskModal — Worktree 配置选择

**Files:**
- Modify: `frontend/src/components/CreateTaskModal.tsx`

- [ ] **Step 1: 在 CreateTaskModal 中添加 Worktree 配置下拉框**

在 `frontend/src/components/CreateTaskModal.tsx` 中：

**1a.** 添加导入：

```typescript
import { getWorktreeConfigs } from '../services/api';
import type { WorktreeConfig } from '../types';
```

**1b.** 在组件中添加 state：

```typescript
const [wtConfigs, setWtConfigs] = useState<WorktreeConfig[]>([]);
```

**1c.** 在 form state 初始值中添加 `worktree_config_id`：

```typescript
const [form, setForm] = useState<TaskCreate & { worktree_config_id?: string }>({
    title: '',
    description: '',
    acceptance_criteria: '',
    priority: 'medium',
    assignee: '',
    estimated_hours: undefined,
    due_date: null,
    worktree_config_id: undefined,
  });
```

**1d.** 添加 useEffect 加载 worktree configs：

```typescript
useEffect(() => {
    if (open) {
      getWorktreeConfigs().then(setWtConfigs).catch(() => {});
    }
  }, [open]);
```

**1e.** 在表单中（提交按钮之前），添加 worktree 配置下拉框：

```tsx
            {wtConfigs.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Worktree 配置</label>
                <select
                  value={form.worktree_config_id || ''}
                  onChange={(e) => setForm((f) => ({ ...f, worktree_config_id: e.target.value || undefined }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">不使用 Worktree</option>
                  {wtConfigs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
```

**1f.** 在 `onSubmit` 中的 `setForm` reset 中也加上 `worktree_config_id: undefined`。

- [ ] **Step 2: 验证前端编译**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/CreateTaskModal.tsx
git commit -m "feat: add worktree config selector to CreateTaskModal"
```

---

### Task 11: 端到端验证

**Files:** 无新增

- [ ] **Step 1: 启动开发环境**

Run: `bash scripts/start.sh dev`

- [ ] **Step 2: 验证 SettingsPage Worktree tab**

打开 `http://localhost:5173/settings`，切换到 "Worktree 配置" tab。创建一个配置：
- Name: "Feature Branch"
- Branch Template: `feature/{task_id_short}-{task_title_slug}`
- Dir Template: `/tmp/worktrees/{project_name}/{branch_name}`
- Base Repo Path: 选一个本地 git 仓库路径

确认配置出现在列表中，可以编辑和删除。

- [ ] **Step 3: 验证 CreateTaskModal Worktree 选择**

在某个项目的 Board 页面创建任务，确认底部出现 "Worktree 配置" 下拉框。选择刚创建的配置，创建任务。确认任务卡片上出现黄色 "Worktree 待创建" 徽章。

- [ ] **Step 4: 验证 TaskCard 状态显示**

确认 pending 状态的 worktree 显示黄色徽章。

- [ ] **Step 5: 提交（如有修复）**

```bash
git add -A
git commit -m "fix: adjustments from e2e verification"
```
