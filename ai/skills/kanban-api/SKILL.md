---
name: kanban-api
description: >
  Kanban PMP project management platform operations. Use when the user asks to
  create, query, update, or delete projects/tasks, manage kanban boards, link
  code projects, execute task commands, or any workflow involving the kanban
  REST API at localhost:9527. Covers project hierarchy, task status lifecycle
  (backlog→todo→in_progress→review→done), sub-project decomposition, activity
  logs, code project tracking, and task statistics. Triggers on: "看板", "kanban", "project",
  "task", "board", "创建项目/任务", "更新状态", "code project", "执行配置",
  "stats", "statistics", "统计", "进度".
---

# Kanban PMP — Project & Task Management via REST API

You are an agent that manages the Kanban PMP platform through its REST API. Every
operation maps to an HTTP call — there is no direct DB access from this skill.

## Environment

- **Base URL**: `http://localhost:9527/api/v1`
- **Data format**: JSON
- **Date format**: ISO 8601 (`YYYY-MM-DD`)
- **Auth**: None (personal project)

## Enum Values

| Field | Valid Values |
|-------|-------------|
| project.status | `planning`, `active`, `on_hold`, `completed`, `archived` |
| task.status | `backlog`, `todo`, `in_progress`, `review`, `done`, `cancelled` |
| task.priority | `critical`, `high`, `medium`, `low` |
| task.task_type | `task`, `milestone`, `epic` |

## Decision Flow

```
User request
  ├─ "create project" → POST /projects
  ├─ "create task"    → POST /projects/{id}/tasks
  ├─ "move task"      → PUT /tasks/{id}/status (check workflow rules first!)
  ├─ "board/view"     → GET /projects/{id}/board
  ├─ "link code"      → PUT /tasks/{id} with code_project_ids
  ├─ "sub-project"    → POST /tasks/{id}/create-sub-project
  ├─ "execute/run"    → POST /tasks/{id}/execute
  ├─ "search/find"    → GET /tasks/search?q=
  ├─ "activity/log"   → GET /projects/{id}/activity-logs
  ├─ "stats/statistics/进度/统计" → GET /statistics
  └─ "setting/config" → CRUD on /execution-configs or /code-projects
```

## API Quick Reference

### Projects

```bash
# List
curl -s http://localhost:9527/api/v1/projects?status={status} | jq .

# Tree (hierarchy)
curl -s http://localhost:9527/api/v1/projects/tree | jq .

# Create
curl -s -X POST http://localhost:9527/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"name","parent_id":"optional-parent-uuid"}' | jq .

# Update
curl -s -X PUT http://localhost:9527/api/v1/projects/{id} \
  -H "Content-Type: application/json" \
  -d '{"name":"new"}' | jq .
# Set parent_id: null to detach from parent. Circular parent → 400.

# Delete (children become root, tasks cascade-delete)
curl -s -X DELETE http://localhost:9527/api/v1/projects/{id}  # → 204

# Status
curl -s -X PUT http://localhost:9527/api/v1/projects/{id}/status \
  -H "Content-Type: application/json" \
  -d '{"status":"active"}' | jq .
```

### Tasks

```bash
# List
curl -s "http://localhost:9527/api/v1/projects/{pid}/tasks?status={status}" | jq .

# Create
curl -s -X POST http://localhost:9527/api/v1/projects/{pid}/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"title"}' | jq .
# Optional: description, acceptance_criteria, implementation_plan, priority,
#   task_type, assignee, estimated_hours, start_date, due_date, tags,
#   code_project_ids

# Update
curl -s -X PUT http://localhost:9527/api/v1/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"progress":50}' | jq .
# Optional: title, description, acceptance_criteria, implementation_plan,
#   priority, task_type, assignee, estimated_hours, actual_hours,
#   progress (0-100), start_date, due_date, tags, sub_project_id,
#   code_project_ids (full replacement; omit key to leave unchanged)

# Delete → 204
curl -s -X DELETE http://localhost:9527/api/v1/tasks/{id}

# Search
curl -s "http://localhost:9527/api/v1/tasks/search?q=keyword" | jq .

# Move (column ordering)
curl -s -X PUT http://localhost:9527/api/v1/tasks/{id}/move \
  -H "Content-Type: application/json" \
  -d '{"sort_order":3}' | jq .
```

### Status Transitions (CRITICAL — check before every status change)

```
Forward (adjacent only):  backlog → todo → in_progress → review → done
Backward (any direction): todo → backlog, in_progress → todo,
                          review → in_progress, done → review
Any → cancelled           allowed
cancelled →               only backlog

422 errors:
  - backlog → todo: implementation_plan must be non-empty
  - in_progress → done: forbidden (must go through review)
  - any other invalid transition

Auto: done → progress=100, completed_at=now
      leaving done → completed_at cleared, progress unchanged
```

### Sub-Project

```bash
# Create sub-project from task (one per task; repeat → 400)
curl -s -X POST http://localhost:9527/api/v1/tasks/{id}/create-sub-project \
  -H "Content-Type: application/json" \
  -d '{"name":"name","description":"optional"}' | jq .
```

### Code Projects

```bash
# CRUD
curl -s http://localhost:9527/api/v1/code-projects | jq .
curl -s -X POST http://localhost:9527/api/v1/code-projects \
  -H "Content-Type: application/json" \
  -d '{"name":"repo-name","description":"...","repo_url":"..."}' | jq .
curl -s -X PUT http://localhost:9527/api/v1/code-projects/{id} \
  -H "Content-Type: application/json" \
  -d '{"name":"new"}' | jq .
curl -s -X DELETE http://localhost:9527/api/v1/code-projects/{id}  # → 204

# Link to task (full replacement on update, omit key to leave unchanged)
curl -s -X PUT http://localhost:9527/api/v1/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"code_project_ids":["uuid1","uuid2"]}' | jq .
```

### Execution Configs & Execute

```bash
# CRUD for execution configs
curl -s http://localhost:9527/api/v1/execution-configs | jq .
curl -s -X POST http://localhost:9527/api/v1/execution-configs \
  -H "Content-Type: application/json" \
  -d '{"name":"CI","command_template":"curl -X POST https://ci.example.com/build -d task_id={task_id}","description":"..."}' | jq .
curl -s -X PUT http://localhost:9527/api/v1/execution-configs/{id} \
  -H "Content-Type: application/json" \
  -d '{"name":"new"}' | jq .
curl -s -X DELETE http://localhost:9527/api/v1/execution-configs/{id}

# Execute a config against a task
curl -s -X POST http://localhost:9527/api/v1/tasks/{id}/execute \
  -H "Content-Type: application/json" \
  -d '{"config_id":"uuid"}' | jq .
# → {stdout, stderr, exit_code, success}
# Placeholders: {task_id}, {task_title}, {task_status}, {task_priority},
#   {task_type}, {task_assignee}, {task_description},
#   {task_acceptance_criteria}, {task_due_date}, {task_start_date},
#   {task_estimated_hours}, {task_actual_hours}, {task_progress},
#   {task_tags}, {project_id}
```

### Activity Logs

```bash
curl -s "http://localhost:9527/api/v1/projects/{pid}/activity-logs?limit=50" | jq .
```

### Board

```bash
curl -s http://localhost:9527/api/v1/projects/{pid}/board | jq .
```

### Statistics

```bash
# Global (all projects)
curl -s http://localhost:9527/api/v1/statistics | jq .

# Per project
curl -s "http://localhost:9527/api/v1/statistics?project_id={uuid}" | jq .
```

Returns daily (30d), weekly (12w), monthly (12m) aggregations. Each entry has:
- `completed_count` — tasks that reached `done` status during this period
- `progress_delta` — net progress change (%), normalized by active task count. Represents how much closer the overall project moved toward completion.

Data source: `TaskStatusHistory` table — a row is inserted every time a task changes status via `PUT /tasks/{id}/status`, recording `old_status`, `new_status`, `old_progress`, `new_progress`, and `changed_at`.

## Response Schemas

### Project
```json
{
  "id":"uuid","name":"string","description":"string|null",
  "status":"planning|active|on_hold|completed|archived",
  "parent_id":"uuid|null","start_date":"date|null","end_date":"date|null",
  "created_at":"datetime","updated_at":"datetime"
}
```

### ProjectTree (extends Project)
```json
{
  "...Project fields...":"",
  "is_completed":false,"progress":0,
  "children":["ProjectTree","..."]
}
```

### Task
```json
{
  "id":"uuid","project_id":"uuid",
  "wbs_element_id":"uuid|null","sprint_id":"uuid|null",
  "title":"string","description":"string|null",
  "acceptance_criteria":"string|null",
  "implementation_plan":"string|null",
  "status":"backlog|todo|in_progress|review|done|cancelled",
  "priority":"critical|high|medium|low",
  "task_type":"task|milestone|epic",
  "assignee":"string|null",
  "estimated_hours":"number|null","actual_hours":"number|null",
  "progress":0,"start_date":"date|null","due_date":"date|null",
  "completed_at":"datetime|null","sort_order":0,
  "sub_project_id":"uuid|null",
  "code_projects":[{"id":"uuid","name":"string"}],
  "tags":["string"],"created_at":"datetime","updated_at":"datetime"
}
```

### Statistics
```json
{
  "daily": [
    {"date":"2026-05-22","completed_count":1,"progress_delta":1}
  ],
  "weekly": [
    {"week":"2026-20","completed_count":1,"progress_delta":1}
  ],
  "monthly": [
    {"month":"2026-05","completed_count":1,"progress_delta":1}
  ]
}
```

- `completed_count` — tasks moved to `done` during the period
- `progress_delta` — net progress change normalized by active (non-done, non-cancelled) task count. Represents overall project completion percentage change (0–100 scale).

## Task Status Workflow Guide

Each status defines a distinct phase. The agent MUST adapt its behavior and MUST NOT
perform activities outside the current phase's scope.

### backlog — Solution Design (定方案)

**Goal**: Define the technical approach, produce a concrete and verifiable plan.

**DO:**
1. Explore the codebase, evaluate alternatives, identify affected modules
2. Identify which **code projects** (repositories) are involved — link them via `code_project_ids`
3. Write detailed `implementation_plan`: technical approach, files/modules, key design decisions, step-by-step outline. Reference specific code projects and their paths.
4. Define `acceptance_criteria` in Given/When/Then or checklist format
5. Ask user about ambiguities, edge cases, trade-offs before finalizing
6. Iterate on the plan based on user feedback

**DON'T:**
- Do NOT write implementation code — solution design only
- Do NOT create child tasks or sub-projects until user approves the plan
- Do NOT move to `todo` until user confirms the plan is ready

**Exit**: `implementation_plan` non-empty AND user approves. (API enforces non-empty for backlog→todo: 422 otherwise)

### todo — Detail Confirmation (确认细节)

**Goal**: Final checkpoint before implementation.

**DO:**
1. Review `implementation_plan` — all steps still valid and in correct order?
2. Verify `acceptance_criteria` cover happy path AND error scenarios
3. Confirm file paths, function names, module boundaries against current codebase
4. Verify `code_projects` links — all affected repos linked, irrelevant ones removed
5. Identify blockers or prerequisites
6. Add implementation details if gaps found (edge cases, error handling)

**DON'T:**
- Do NOT start coding — verification gate, not implementation
- Do NOT rewrite the plan from scratch — refine, don't redesign
- Do NOT move to `in_progress` with unresolved questions

**Exit**: All details confirmed, no open questions.

### in_progress — Implementation (编码实施)

**Goal**: Execute the plan — write code in linked **code projects**, run tests, deliver.

**DO:**
1. Follow `implementation_plan` strictly step by step
2. Scope all changes to the linked `code_projects` — these are the repos you work in
3. Write production-quality code: correct, secure, well-structured
4. Run type checks and tests after each meaningful change
5. Update `progress` field to reflect actual completion
6. If deviation is necessary, update plan AND note the reason
7. Write or update tests for new code

**DON'T:**
- Do NOT revisit requirements or redesign — that belongs in `backlog`
- Do NOT modify repos not linked to the task — update `code_projects` first
- Do NOT skip plan steps without justification
- Do NOT move to `review` with failing tests or type errors
- Do NOT make unrelated refactors or "drive-by" changes

**Exit**: Code complete, tests pass, all plan steps checked off.

### review — Code Review (代码审查)

**Goal**: Independent, thorough review. Act as reviewer, not author.

**DO:**
1. **Code quality**: style, naming, dead code, redundancy
2. **Logic correctness**: core logic, edge cases, error paths
3. **Security**: injection, XSS, sensitive data exposure
4. **Test coverage**: tests exist, pass, cover edge cases
5. **Plan consistency**: implementation matches plan, deviations justified
6. **Acceptance criteria**: verify each criterion explicitly
7. Diff the changes — review the actual delta

**DON'T:**
- Do NOT write new code — only review and identify issues
- Do NOT approve with failing tests, type errors, or unmet criteria
- Do NOT skip security review
- Do NOT approve with unresolved concerns

**Outcome**: Pass → `done`. Issues → back to `in_progress`, document each issue in `description`.

### done — Completed

Auto: `progress=100`, `completed_at=now`. Revert to `review` if issues found. Never directly to `in_progress`.

### cancelled — Cancelled

Any status → `cancelled`. Restart only via `backlog`.

## Requirements Analysis & Task Decomposition

When receiving a user requirement, **analyze BEFORE creating tasks**.

### Analysis Process
1. **Understand**: extract core goals and constraints
2. **Scope**: identify affected modules and code projects, decide if splitting needed
3. **Confirm**: ask user about ambiguities before proceeding
4. **Decompose**: break into independently deliverable tasks
5. **Fill fields**: complete `description`, `implementation_plan`, `acceptance_criteria` for each

### Decomposition Principles
- Each task = complete minimal deliverable unit (independently completable, verifiable, mergeable)
- Granularity: typically 1-3 days per task
- Clear dependencies: reference related tasks in titles and descriptions
- Large scope → sub-project: if spanning multiple subsystems or >5 tasks, create a sub-project first

### Field Guidelines

**description**: 2-5 sentences on goal, scope, context. Include source (user feedback, business goal, tech debt). Explain what problem the task solves and which modules are involved.

**implementation_plan**: Technical approach, key steps, design decisions, files/modules, tech choices. Must be filled before `backlog → todo` (API 422 otherwise). Specific enough to execute step-by-step.

**acceptance_criteria**: Given/When/Then format or checklist (`- ` prefix). Each specific and verifiable. Cover happy path and error scenarios.

## Common Workflows

### Create project and batch-add tasks
1. `POST /projects` → record `id`
2. `POST /projects/{id}/tasks` → create tasks (can parallelize)

### Build project hierarchy
1. `POST /projects` → root project
2. `POST /projects` with `parent_id` → sub-project
3. `GET /projects/tree` → verify nesting
4. `PUT /projects/{id}` with `parent_id: null` → detach

### Move task across columns
1. `GET /projects/{id}/board` → see distribution
2. `PUT /tasks/{id}/status` → change column
3. Only sequential forward: `backlog → todo → in_progress → review → done`
4. Optional: `PUT /tasks/{id}/move` → adjust order

### Link task to code projects
1. `GET /code-projects` → list available repos
2. `PUT /tasks/{id}` with `code_project_ids` → link repos to task
3. During `in_progress`, scope all changes to linked repos

### Decompose task into sub-project
1. `POST /tasks/{id}/create-sub-project` → create and link
2. `GET /tasks/{id}` → verify `sub_project_id` is set
3. `GET /projects/{sub_project_id}/board` → enter sub-project board

### Clean up project
1. `PUT /projects/{id}/status` with `{"status":"completed"}` → mark complete
2. `DELETE /projects/{id}` → children become root, tasks cascade-delete

### View statistics
1. `GET /statistics` → global daily/weekly/monthly stats
2. `GET /statistics?project_id={uuid}` → per-project breakdown
3. Optional: `GET /projects/{id}/activity-logs` → drill into specific status changes

## Notes
- All requests and responses are JSON
- Deleting a project cascades to all its tasks and boards
- Child projects become root when parent is deleted
- Task `status` and `progress` managed via separate endpoints
- `backlog → todo` requires non-empty `implementation_plan`
- Every status change via `PUT /tasks/{id}/status` records a row in `TaskStatusHistory` (old/new status + old/new progress + timestamp), powering the `/statistics` endpoint
- Interactive docs: `http://localhost:9527/docs`
- Use `jq` to parse JSON responses
