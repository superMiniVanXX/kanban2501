# Kanban-PMP 任务管理系统设计文档

## 1. 概述

一套融合敏捷看板与 PMP 项目管理理念的任务管理工具，聚焦于**项目创建与计划过程**。支持 WBS 工作分解、任务依赖关系、甘特图进度可视化和看板拖拽交互。

### 1.1 目标用户

以个人使用为核心，架构预留多用户扩展能力（assignee 字段、用户表）。

### 1.2 技术栈

| 层次 | 选型 | 说明 |
|------|------|------|
| 后端 | FastAPI + SQLAlchemy | Python，自动生成 API 文档 |
| 数据库 | SQLite | 零配置，本地单文件 |
| 前端 | React + Vite | SPA，拖拽 + 甘特图 |
| 看板拖拽 | @hello-pangea/dnd | react-beautiful-dnd 的活跃 fork |
| 甘特图 | gantt-task-react | 支持依赖关系的甘特图组件 |
| 运维 | start.sh / stop.sh | 一键启停 |

---

## 2. 数据模型

### 2.1 ER 关系

```
User (用户，预留)
  └── Project (项目)
        ├── WBSElement (WBS 元素，树形自引用)
        │     └── Task (任务/工作包)
        │           ├── TaskDependency (前后置依赖)
        │           └── TaskComment (评论，预留)
        ├── Sprint (迭代/阶段)
        │     └── sprint_task 关联表
        └── Board (看板)
              └── Column (列定义)
```

### 2.2 核心表结构

#### Project（项目）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(200) | 项目名称 |
| description | TEXT | 项目描述 |
| status | ENUM | planning / active / on_hold / completed / archived |
| start_date | DATE | 计划开始日期 |
| end_date | DATE | 计划结束日期 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

#### WBSElement（WBS 元素）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID FK | 所属项目 |
| parent_id | UUID FK nullable | 父元素（NULL 为根节点） |
| name | VARCHAR(200) | 元素名称 |
| wbs_code | VARCHAR(50) | WBS 编码，如 1.2.3 |
| description | TEXT | 描述 |
| sort_order | INTEGER | 同级排序 |
| is_leaf | BOOLEAN | 是否叶子节点（关联 Task） |

#### Task（任务）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID FK | 所属项目 |
| wbs_element_id | UUID FK nullable | 关联 WBS 元素 |
| sprint_id | UUID FK nullable | 所属迭代 |
| title | VARCHAR(300) | 任务标题 |
| description | TEXT | 详细描述 |
| status | ENUM | backlog / todo / in_progress / review / done / cancelled |
| priority | ENUM | critical / high / medium / low |
| task_type | ENUM | task / milestone / epic |
| assignee | VARCHAR(100) | 负责人（预留扩展为 user_id FK） |
| estimated_hours | FLOAT nullable | 预估工时 |
| actual_hours | FLOAT nullable | 实际工时 |
| progress | INTEGER | 完成百分比 0-100 |
| start_date | DATE nullable | 计划开始 |
| due_date | DATE nullable | 计划截止 |
| completed_at | DATETIME nullable | 实际完成时间 |
| sort_order | INTEGER | 看板列内排序 |
| tags | JSON | 标签数组 |

#### TaskDependency（任务依赖）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| predecessor_id | UUID FK | 前置任务 |
| successor_id | UUID FK | 后继任务 |
| dependency_type | ENUM | FS（完成-开始）/ FF（完成-完成）/ SS（开始-开始）/ SF（开始-完成） |
| lag_days | INTEGER | 滞后天数，默认 0 |

#### Sprint（迭代）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| project_id | UUID FK | 所属项目 |
| name | VARCHAR(200) | 迭代名称 |
| goal | TEXT | 迭代目标 |
| status | ENUM | planning / active / completed |
| start_date | DATE | 开始日期 |
| end_date | DATE | 结束日期 |

#### Board / Column（看板配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键（Board） |
| project_id | UUID FK | 所属项目（Board） |
| name | VARCHAR(100) | 看板名称（Board）/ 列名（Column） |
| column_status | ENUM | 列对应的任务状态（Column） |
| wip_limit | INTEGER nullable | 在制品限制（Column） |
| sort_order | INTEGER | 排序（Column） |

---

## 3. API 设计

所有 API 遵循 RESTful 风格，前缀 `/api/v1`。

### 3.1 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /projects | 项目列表（支持分页、状态过滤） |
| POST | /projects | 创建项目 |
| GET | /projects/{id} | 项目详情（含统计摘要） |
| PUT | /projects/{id} | 更新项目 |
| DELETE | /projects/{id} | 删除项目 |
| PUT | /projects/{id}/status | 变更项目状态 |

### 3.2 WBS 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /projects/{id}/wbs | 获取 WBS 树（完整树形 JSON） |
| POST | /projects/{id}/wbs | 创建 WBS 元素 |
| PUT | /wbs/{element_id} | 更新 WBS 元素 |
| DELETE | /wbs/{element_id} | 删除 WBS 元素（含子节点） |
| PUT | /wbs/{element_id}/move | 移动 WBS 元素（改变父级或排序） |

### 3.3 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /projects/{id}/tasks | 任务列表（支持状态、优先级、负责人过滤） |
| POST | /projects/{id}/tasks | 创建任务 |
| GET | /tasks/{id} | 任务详情 |
| PUT | /tasks/{id} | 更新任务 |
| DELETE | /tasks/{id} | 删除任务 |
| PUT | /tasks/{id}/status | 变更任务状态（看板拖拽调用） |
| PUT | /tasks/{id}/move | 改变任务排序（看板列内排序） |
| POST | /tasks/{id}/dependencies | 添加依赖关系 |
| DELETE | /tasks/{id}/dependencies/{dep_id} | 删除依赖关系 |

### 3.4 迭代管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /projects/{id}/sprints | 迭代列表 |
| POST | /projects/{id}/sprints | 创建迭代 |
| PUT | /sprints/{id} | 更新迭代 |
| PUT | /sprints/{id}/status | 变更迭代状态 |
| POST | /sprints/{id}/tasks | 向迭代添加任务 |
| DELETE | /sprints/{id}/tasks/{task_id} | 从迭代移除任务 |

### 3.5 看板视图

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /projects/{id}/board | 获取看板（含列定义及列内任务） |
| PUT | /board/{board_id}/columns | 更新列配置（WIP 限制等） |

### 3.6 甘特图视图

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /projects/{id}/gantt | 获取甘特图数据（含任务时间线、依赖关系、关键路径标记） |

---

## 4. 前端架构

### 4.1 页面结构

```
/                           → 项目列表页
/projects/:id               → 项目仪表盘（概览统计）
/projects/:id/board         → 看板视图（拖拽）
/projects/:id/wbs           → WBS 视图（树形编辑器）
/projects/:id/gantt         → 甘特图视图
/projects/:id/tasks         → 任务列表（表格视图）
/projects/:id/sprints       → 迭代管理
/projects/:id/settings      → 项目设置
/tasks/:id                  → 任务详情（侧滑面板或新页面）
```

### 4.2 核心组件

| 组件 | 说明 |
|------|------|
| ProjectList | 项目卡片列表，支持创建、筛选 |
| ProjectDashboard | 项目概览：进度环、统计数字、即将到期任务 |
| KanbanBoard | 看板：多列拖拽，WIP 限制提示，快速创建任务 |
| WBSTree | WBS 树形编辑器：增删改、拖拽排序、缩进折叠 |
| GanttChart | 甘特图：时间线、依赖箭头、关键路径高亮、里程碑菱形标记 |
| TaskDetail | 任务详情面板：基础信息、依赖关系、工时记录、评论 |
| SprintManager | 迭代管理：创建迭代、拖入任务、燃尽图（预留） |
| TaskForm | 任务创建/编辑表单 |

### 4.3 前端状态管理

使用 React Context + useReducer，无需引入 Redux。主要 Context：

- **ProjectContext**：当前项目数据
- **BoardContext**：看板状态（列、任务位置）
- **NotificationContext**：全局通知/toast

### 4.4 UI 风格

使用 Tailwind CSS，深色/浅色主题切换。整体风格简洁专业，参考 Linear / Notion 的克制感。

---

## 5. 后端架构

### 5.1 目录结构

```
kanban/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口，挂载路由
│   │   ├── database.py          # SQLAlchemy 引擎 + Session
│   │   ├── models/              # ORM 模型
│   │   │   ├── project.py
│   │   │   ├── wbs.py
│   │   │   ├── task.py
│   │   │   ├── sprint.py
│   │   │   └── board.py
│   │   ├── schemas/             # Pydantic 请求/响应模型
│   │   │   ├── project.py
│   │   │   ├── wbs.py
│   │   │   ├── task.py
│   │   │   ├── sprint.py
│   │   │   └── board.py
│   │   ├── routers/             # API 路由
│   │   │   ├── projects.py
│   │   │   ├── wbs.py
│   │   │   ├── tasks.py
│   │   │   ├── sprints.py
│   │   │   └── board.py
│   │   └── services/            # 业务逻辑
│   │       ├── wbs_service.py   # WBS 树操作、编号自动生成
│   │       ├── gantt_service.py # 甘特图数据聚合、关键路径计算
│   │       └── board_service.py # 看板状态流转、WIP 校验
│   ├── requirements.txt
│   └── alembic/                 # 数据库迁移（预留）
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   ├── services/            # API 调用封装
│   │   ├── types/
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   ├── start.sh                 # 一键启动（构建前端 + 启动后端）
│   ├── stop.sh                  # 停止服务
│   └── seed.py                  # 示例数据填充
└── docs/
    └── 2026-05-12-kanban-pmp-design.md
```

### 5.2 关键业务逻辑

**WBS 编号自动生成：** 创建或移动 WBS 元素时，自动重算 `wbs_code`。规则：根节点为 1, 2, 3...，子节点为 1.1, 1.2...，以此类推。

**关键路径计算：** 甘特图服务中实现正向/反向传播算法：
1. 正向传播：从无依赖的任务开始，计算每个任务的最早开始/结束时间
2. 反向传播：从最后任务回溯，计算最晚开始/结束时间
3. 总浮动时间 = 0 的任务组成关键路径，高亮显示

**看板状态流转验证：** 任务状态变更时校验：
- 是否违反 WIP 限制
- 依赖任务是否已完成（可配置为警告而非阻断）

---

## 6. 本地运行方案

### 6.1 启动流程（start.sh）

```bash
1. 检查 Python 3.10+ 和 Node.js 18+ 环境
2. 创建 Python venv（首次）
3. pip install -r requirements.txt（首次/依赖变更时）
4. cd frontend && npm install（首次）
5. npm run build → 输出到 backend/static/
6. 启动 FastAPI：uvicorn app.main:app --host 0.0.0.0 --port 8080
7. 浏览器打开 http://localhost:8080
```

FastAPI 通过 StaticFiles 中间件直接 serve 前端构建产物，无需单独的 nginx。

### 6.2 开发模式

```bash
# 后端热重载
cd backend && uvicorn app.main:app --reload --port 8080

# 前端开发服务器（代理 API 到 8080）
cd frontend && npm run dev  # 默认 5173 端口
```

---

## 7. 实施优先级

### Phase 1 — 核心（最小可用）

- [ ] 后端：数据库模型 + 迁移
- [ ] 后端：Project CRUD API
- [ ] 后端：Task CRUD API（含状态变更）
- [ ] 前端：项目列表页 + 创建
- [ ] 前端：看板视图（拖拽）
- [ ] 脚本：start.sh / stop.sh

### Phase 2 — PMP 计划能力

- [ ] 后端：WBS 树操作 API
- [ ] 后端：Task Dependency API
- [ ] 后端：甘特图数据聚合 + 关键路径
- [ ] 前端：WBS 树形编辑器
- [ ] 前端：甘特图视图
- [ ] 前端：任务详情面板（含依赖管理）

### Phase 3 — 增强功能

- [ ] Sprint 迭代管理
- [ ] 项目仪表盘统计
- [ ] 任务筛选/搜索
- [ ] 标签系统
- [ ] 数据导入/导出
