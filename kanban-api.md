---
name: kanban-api
description: REST API reference for Kanban-PMP. Use when creating or managing projects and tasks via HTTP.
---

# Kanban-PMP REST API

## 触发条件
- 用户要求创建、查询、更新、删除看板项目或任务
- 用户需要了解项目层级结构（父子项目）
- 用户需要查询看板状态或移动任务

## 环境信息
- **Base URL**: `http://localhost:9527/api/v1`
- **数据格式**: JSON
- **日期格式**: ISO 8601 (`YYYY-MM-DD`)
- **认证**: 无需认证（个人项目）

## 枚举值

| 字段 | 可选值 |
|------|--------|
| project.status | `planning`, `active`, `on_hold`, `completed`, `archived` |
| task.status | `backlog`, `todo`, `in_progress`, `review`, `done`, `cancelled` |
| task.priority | `critical`, `high`, `medium`, `low` |
| task.task_type | `task`, `milestone`, `epic` |

## 项目 API

### 列出项目
```bash
curl -s http://localhost:9527/api/v1/projects?status={status}
```

### 获取项目树（含父子层级）
```bash
curl -s http://localhost:9527/api/v1/projects/tree
```

### 获取单个项目
```bash
curl -s http://localhost:9527/api/v1/projects/{id}
```

### 创建项目
```bash
curl -s -X POST http://localhost:9527/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "项目名称"}'
```

可选字段：`description`, `parent_id`, `start_date`, `end_date`

- `parent_id` 设为现有项目 id 可创建子项目
- `parent_id` 设为 `null` 或不传则为根项目

### 更新项目
```bash
curl -s -X PUT http://localhost:9527/api/v1/projects/{id} \
  -H "Content-Type: application/json" \
  -d '{"name": "新名称"}'
```

所有字段可选：`name`, `description`, `parent_id`, `start_date`, `end_date`

- 设置 `parent_id: null` 可将子项目从父项目中分离
- 循环检测：不能将项目的后代设为父项目（返回 400）

### 删除项目
```bash
curl -s -X DELETE http://localhost:9527/api/v1/projects/{id}
```
子项目自动变为根项目（parent_id 设为 null）。返回 204。

### 更新项目状态
```bash
curl -s -X PUT http://localhost:9527/api/v1/projects/{id}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

---

## 任务 API

### 列出项目任务
```bash
curl -s "http://localhost:9527/api/v1/projects/{project_id}/tasks?status={status}"
```

### 获取单个任务
```bash
curl -s http://localhost:9527/api/v1/tasks/{id}
```

### 创建任务
```bash
curl -s -X POST http://localhost:9527/api/v1/projects/{project_id}/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "任务标题"}'
```

可选字段：`description`, `acceptance_criteria`, `priority`（默认 medium）, `task_type`（默认 task）, `assignee`, `estimated_hours`, `start_date`, `due_date`, `tags`

### 更新任务
```bash
curl -s -X PUT http://localhost:9527/api/v1/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"progress": 50}'
```

所有字段可选：`title`, `description`, `acceptance_criteria`, `priority`, `task_type`, `assignee`, `estimated_hours`, `actual_hours`, `progress`（0-100）, `start_date`, `due_date`, `tags`

### 更改任务状态
```bash
curl -s -X PUT http://localhost:9527/api/v1/tasks/{id}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
```

设为 `done` 时自动：`progress = 100`, `completed_at = 当前时间`
离开 `done` 时自动：清除 `completed_at`（进度保持不变）

### 移动任务（列内排序）
```bash
curl -s -X PUT http://localhost:9527/api/v1/tasks/{id}/move \
  -H "Content-Type: application/json" \
  -d '{"sort_order": 3}'
```

### 从任务创建子项目
```bash
curl -s -X POST http://localhost:9527/api/v1/tasks/{id}/create-sub-project \
  -H "Content-Type: application/json" \
  -d '{"name": "子项目名称", "description": "可选描述"}'
```
自动：
- 创建新项目（父项目为当前任务所属项目）
- 将任务的 `sub_project_id` 设为新项目的 id
- 每个任务只能关联一个子项目（重复调用返回 400）
- 返回更新后的 Task

### 删除任务
```bash
curl -s -X DELETE http://localhost:9527/api/v1/tasks/{id}
```
返回 204。

---

## 看板 API

### 获取看板
```bash
curl -s http://localhost:9527/api/v1/projects/{project_id}/board
```
返回带列和按状态分组任务的看板结构。

---

## 常用工作流

### 创建项目并批量添加任务
1. `POST /projects` → 记录返回的 `id`
2. `POST /projects/{id}/tasks` → 逐条创建任务（可并行）

### 构建项目层级
1. `POST /projects` → 创建根项目，记录 `id`
2. `POST /projects` 带 `{"parent_id": "<根项目id>"}` → 创建子项目
3. `GET /projects/tree` → 验证嵌套结构
4. `PUT /projects/{子项目id}` 带 `{"parent_id": null}` → 分离子项目

### 推动任务跨列
1. `GET /projects/{id}/board` → 查看任务在各列的分布
2. `PUT /tasks/{task_id}/status` → 切换列（如 `todo` → `in_progress`）
3. 可选 `PUT /tasks/{task_id}/move` → 调整列内顺序

### 更新任务进度
`PUT /tasks/{task_id}` 带 `{"progress": 60}` → 直接设置 0-100

### 完成任务
`PUT /tasks/{task_id}/status` 带 `{"status": "done"}` → 自动进度 100%

### 从任务拆分子项目
1. `POST /tasks/{task_id}/create-sub-project` 带 `{"name": "子项目名"}` → 创建子项目并关联
2. `GET /tasks/{task_id}` → 验证 `sub_project_id` 已设置
3. `GET /projects/{sub_project_id}/board` → 进入子项目看板，添加细分任务

### 清理项目
1. `PUT /projects/{id}/status` 带 `{"status": "completed"}` → 标记完成
2. `DELETE /projects/{id}` → 删除项目（子项目变根项目，任务级联删除）

---

## 响应格式

### Project
```json
{
  "id": "uuid", "name": "string", "description": "string|null",
  "status": "planning|active|on_hold|completed|archived",
  "parent_id": "uuid|null",
  "start_date": "date|null", "end_date": "date|null",
  "created_at": "datetime", "updated_at": "datetime"
}
```

### ProjectTree（继承 Project，增加递归 children）
```json
{
  "...Project fields...": "",
  "children": ["ProjectTree", "..."]
}
```

### Task
```json
{
  "id": "uuid", "project_id": "uuid",
  "title": "string", "description": "string|null",
  "acceptance_criteria": "string|null",
  "status": "backlog|todo|in_progress|review|done|cancelled",
  "priority": "critical|high|medium|low",
  "task_type": "task|milestone|epic",
  "assignee": "string|null",
  "estimated_hours": "number|null", "actual_hours": "number|null",
  "progress": 0, "start_date": "date|null", "due_date": "date|null",
  "completed_at": "datetime|null", "sort_order": 0,
  "sub_project_id": "uuid|null",
  "tags": ["string"], "created_at": "datetime", "updated_at": "datetime"
}
```

## 交互式文档
FastAPI 自动生成 Swagger UI：浏览器打开 `http://localhost:9527/docs` 可直接测试所有 API。

## LLM 需求分析指南

当 LLM 被要求分析需求并创建任务时，应填写以下字段：

### description（描述）
- 用 2-5 句话清晰描述任务的目标和范围
- 说明该任务要解决什么问题、涉及哪些模块
- 如果任务范围过大，建议拆分为多个子任务或创建子项目

### acceptance_criteria（验收标准）
- 使用 Given/When/Then 格式编写，每行一条
- 或使用 checklist 格式（以 `- ` 开头）
- 每条标准应具体、可验证

**示例：**
```json
{
  "title": "用户登录功能",
  "description": "实现基于 JWT 的用户登录接口。支持用户名/密码认证，返回 access token 和 refresh token。需集成现有的用户表并处理登录失败、账户锁定等异常场景。",
  "acceptance_criteria": "- Given 注册用户输入正确密码 When 点击登录 Then 返回 JWT token 并跳转首页\n- Given 用户输入错误密码 When 点击登录 Then 返回 401 并提示\"密码错误\"\n- Given 连续 5 次失败登录 When 再次尝试 Then 账户锁定 15 分钟\n- Given 已登录用户访问受保护路由 When token 有效 Then 正常放行"
}
```

## 注意事项
- 所有请求和响应均为 JSON
- 项目删除会级联删除其下所有任务和看板
- 子项目在父项目被删除后自动变为根项目
- 任务的 `status` 和 `progress` 通过不同端点独立管理
- 无认证机制，仅限本地或个人使用
