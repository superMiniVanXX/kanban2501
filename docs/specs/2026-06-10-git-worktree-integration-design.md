# Git Worktree 集成设计

## 概述

为 Kanban 任务的"开始开发"阶段自动准备独立的 Git Worktree 环境。通过配置模板定义分支命名和目录规则，任务可预设或手动触发 worktree 创建，实现开发环境的隔离与自动化。

## 需求总结

1. **双模式触发**：任务创建时预设 + 随时手动触发/重建
2. **模板驱动**：分支名和目录路径通过 WorktreeConfig 模板生成，在 Settings 中统一管理
3. **无缝集成**：已有 worktree 时，`##workdir##` 自动指向 worktree 目录
4. **可配置清理**：模板中设定是否在任务完成/取消时自动清理

## 数据模型

### 新增 WorktreeConfig（配置模板）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String(36) PK | UUID |
| name | String(200) | 模板名称，如 "feature分支" |
| description | Text | 说明 |
| branch_template | String(500) | 分支命名模板，如 `feature/{task_id_short}-{task_title_slug}` |
| dir_template | String(500) | 目录命名模板，如 `/home/xuxin/worktrees/{project_name}/{branch_name}` |
| auto_cleanup | Boolean | 任务完成/取消时是否自动清理 |
| base_repo_path | String(1000) | 主仓库路径（用于执行 `git worktree add`） |
| created_at | DateTime | |
| updated_at | DateTime | |

**模板变量**：

- 分支模板：`{task_id}`, `{task_id_short}`(前8位), `{task_title}`, `{task_title_slug}`, `{task_type}`, `{task_priority}`, `{task_assignee}`, `{project_id}`, `{project_name}`
- 目录模板：以上所有变量 + `{branch_name}`（展开后的分支名）

### 新增 Worktree（运行时实例）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String(36) PK | UUID |
| task_id | String(36) FK → tasks.id | 所属任务 |
| config_id | String(36) FK → worktree_configs.id | 使用的配置 |
| branch | String(500) | 实际创建的分支名 |
| path | String(1000) | 实际 worktree 目录路径 |
| status | Enum | `pending`, `active`, `removed`, `error` |
| error_message | Text | 创建/删除失败时的错误信息 |
| created_at | DateTime | |
| updated_at | DateTime | |

### Task 模型变更

新增一个可空外键：

| 字段 | 类型 | 说明 |
|------|------|------|
| worktree_id | String(36) FK → worktrees.id | nullable |

## API 设计

### WorktreeConfig CRUD

```
GET    /api/v1/worktree-configs                    列出所有配置
POST   /api/v1/worktree-configs                    创建配置
PUT    /api/v1/worktree-configs/{id}               更新配置
DELETE /api/v1/worktree-configs/{id}               删除配置
```

### Task Worktree 操作

```
POST   /api/v1/tasks/{id}/worktree                 为任务创建 worktree
  Body: { config_id: string }
  流程: 模板变量展开 → git worktree add → 写入 Worktree 记录

DELETE /api/v1/tasks/{id}/worktree                 移除任务的 worktree
  流程: git worktree remove → 更新 Worktree 状态为 removed

GET    /api/v1/tasks/{id}/worktree                 查询任务的 worktree 状态
  返回: Worktree 详情（分支、路径、状态）或 404

PUT    /api/v1/tasks/{id}/worktree                 更新 worktree（切换 config 后重建）
  Body: { config_id: string }
  流程: 已有 active worktree → 先 remove → 再按新 config 重新 add
```

### 已有接口变更

**TaskResponse** 新增：
```python
worktree: WorktreeBrief | None = None

class WorktreeBrief(BaseModel):
    id: str
    branch: str
    path: str
    status: str
```

**TaskCreate / TaskUpdate** 新增：
```python
worktree_config_id: str | None = None
```

创建任务时提供 `worktree_config_id` → 自动创建 `pending` 状态的 Worktree 记录（不立即执行 git worktree add）。

**`##workdir##` 解析逻辑**（`execute_task` 中）：
```python
if task.worktree and task.worktree.status == "active":
    workdir = task.worktree.path
elif task.code_projects and task.code_projects[0].path:
    workdir = task.code_projects[0].path
```

**Status 变更钩子**（`workflow_service.py`）：
- `→ in_progress`：如有 `pending` worktree → 自动执行 `git worktree add`
- `→ done / cancelled`：如 config 标记 `auto_cleanup` → 自动执行 `git worktree remove`

## 前端变更

### SettingsPage

新增 "Worktree 配置" 管理区域（与 ExecutionConfig、CodeProject 平行）：
- 配置列表（名称、分支模板、目录模板、自动清理开关）
- 新增/编辑弹窗
- 删除按钮

### TaskCard

在 code_projects 徽章旁显示 worktree 状态：
- `pending` → 黄色 "Worktree 待创建"（可点击触发创建）
- `active` → 绿色 "Worktree: feature/xxx"（可点击展开操作）
- `removed` → 不显示
- `error` → 红色 "Worktree 错误"（hover 显示错误信息）

### 任务详情弹窗

新增 "Worktree 环境" 区块：
- 未配置：显示 "设置 Worktree" 按钮 → config 选择器
- 已配置：显示 config 名称、分支名、目录路径、状态 + 操作按钮

### CreateTaskModal

表单底部新增可选的 "Worktree 配置" 下拉框（默认空，选项来自 WorktreeConfig 列表）。

## Git 操作与错误处理

### worktree_service.py

```python
def create_worktree(base_repo: str, branch: str, target_path: str) -> dict
def remove_worktree(path: str) -> dict
def validate_repo(path: str) -> dict
def expand_template(template: str, task: Task, project: Project, branch: str = None) -> str
```

`create_worktree` 流程：
1. 验证 base_repo_path 是有效 git 仓库
2. 验证 target_path 不存在
3. 检查分支名是否已存在
4. 执行 `git -C {base_repo} worktree add -b {branch} {target_path}`
5. 成功 → active；失败 → error + error_message

### 错误处理

| 场景 | 处理 |
|------|------|
| base_repo 不是 git 仓库 | 422，提示检查 WorktreeConfig |
| 目标目录已存在 | 409，提示路径冲突 |
| 分支名已存在 | 409，建议更换模板 |
| git worktree add 超时 | 10s 超时，状态设为 error |
| git worktree remove 失败 | 状态保持 active，提示手动处理 |
| 自动清理时失败 | 记录 error，不阻塞状态流转 |

### 安全约束

- target_path 不允许在 base_repo 内部
- 路径规范化后检查，防止 `../` 遍历
- git 命令使用参数列表形式，禁止 `shell=True`
