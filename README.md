# Kanban-PMP

Project management platform with hierarchical projects, kanban task boards, and code project tracking.

## Features

- **Hierarchical Projects** — nested project trees with cycle detection
- **Kanban Boards** — drag-and-drop task management with configurable columns and WIP limits
- **Task Workflow** — structured lifecycle: backlog → todo → in_progress → review → done → verify → complete
- **Code Project Tracking** — link Git repositories and track branches/worktrees per task
- **Git Worktree Integration** — create and manage git worktrees from tasks, sync to remote hosts via rsync
- **Task Notifications** — notification channels (desktop/webhook/sound/email) triggered on task status transitions, with in-app queue, delivery logs, and Claude Code agent hook integration
- **Recent Activity Board** — home page overview of recently active tasks
- **Statistics** — daily/weekly/monthly completion charts
- **Soft Delete & Trash** — recoverable deletes with trash page

## Architecture

| Layer | Stack |
|-------|-------|
| Backend | FastAPI + SQLAlchemy 2.0 + SQLite |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| API | REST at `localhost:9527/api/v1` |

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 20+

### Development

```bash
# Clone and start both backend + frontend with hot reload
git clone <repo-url> && cd kanban
bash scripts/start.sh dev

# Backend: http://localhost:9527
# Frontend: http://localhost:5173 (proxies /api → backend)
```

### Production

```bash
bash scripts/start.sh prod
# Builds frontend into backend/static/, serves everything from backend
```

### Manual Setup

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 9527 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Project Structure

```
kanban/
├── backend/           # FastAPI backend
│   ├── app/
│   │   ├── models/    # SQLAlchemy ORM models
│   │   ├── routers/   # API route handlers
│   │   ├── schemas/   # Pydantic request/response models
│   │   └── services/  # Business logic layer
│   └── tests/
├── frontend/          # React frontend
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/  # API client
│       └── types/     # TypeScript interfaces
├── docs/              # Documentation
│   ├── design/        # Design documents
│   ├── specs/         # Feature specifications
│   └── plans/         # Implementation plans
├── skills/            # Claude Code integration skills
├── scripts/           # Utility scripts
└── .github/           # CI/CD and community templates
```

## API

The full REST API is documented in [docs/api-reference.md](docs/api-reference.md).

Key endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/v1/projects` | List / Create projects |
| GET/PUT/DELETE | `/api/v1/projects/{id}` | Project CRUD |
| GET | `/api/v1/projects/{id}/board` | Get kanban board |
| GET/POST | `/api/v1/projects/{id}/tasks` | List / Create tasks |
| GET/PUT/DELETE | `/api/v1/tasks/{id}` | Task CRUD |
| PUT | `/api/v1/tasks/{id}/status` | Update task status |
| POST | `/api/v1/tasks/{id}/execute` | Execute task command |
| GET/POST | `/api/v1/notification-channels` | Notification channel CRUD |
| POST | `/api/v1/notification-channels/{id}/test` | Send a test notification |
| POST | `/api/v1/agent-events` | Receive Claude Code agent hook events |
| GET | `/api/v1/notification-logs` | Notification delivery logs |
| GET | `/api/v1/notifications` | In-app notification queue |
| GET | `/api/v1/tasks/activity` | Recent activity board data |

## Testing

```bash
cd backend && python -m pytest tests/ -v
```

## License

[GPL v3](LICENSE)
