---
name: debian-project-sync
description: >
  Discover debian-packaged projects from a source tree and sync them to the
  KANBAN platform as code projects. Scans debian/control files to extract
  project name (Source), homepage, and description, then registers missing
  ones via the KANBAN REST API. Use when the user wants to "sync debian
  projects", "import debian packages into kanban", "scan source tree and
  register code projects", or "discover projects from debian/control files".
  Triggers on: "debian/control", "debian project", "sync projects", "导入项目",
  "同步代码项目", "扫描debian项目", "debian源码".
tools: Bash, Read
---

# Debian Project Sync — Discover & Register Code Projects

You discover Debian-packaged projects from a local source tree and register
them as **Code Projects** in the Kanban PMP platform via its REST API. The
source of truth for each project is its `debian/control` file.

## When to Use This Skill

The user wants to bulk-import code projects into Kanban by scanning a
directory full of Debian-packaged source repositories. Typical user prompts:

- "sync debian projects under ~/smartos to kanban"
- "扫描 ~/src 下的 debian 项目并导入看板"
- "find all debian/control files and add them as code projects"

## Workflow

### Step 1: Confirm the root directory

Ask the user for the root directory to scan. If they already provided one
in their prompt, use it directly. Otherwise ask:

> Which root directory should I scan for `debian/control` files?

### Step 2: Find all control files

Use `find` to locate every `debian/control` file under the root:

```bash
find <ROOT_DIR> -path "*/debian/control" -type f
```

If no files are found, report this and stop.

### Step 3: Extract metadata from each control file

For each discovered `debian/control`, parse the **first stanza only** (the
source package stanza, before the first blank line). Extract these fields:

| Field | How to extract |
|-------|---------------|
| `name` | `Source:` — the source package name (required) |
| `path` | The project root directory — the parent of the `debian/` directory containing the control file |
| `repo_url` | `Homepage:` — the project homepage URL (optional, omit if absent) |
| `description` | `Description:` — the first line of the description, stopping at the first comma or newline |

**Important parsing rules:**
- Only read fields from the **first stanza** (everything before the first blank line). Stanzas for binary packages (`Package:`) appear after blank lines and must be ignored.
- The `Description:` field in debian/control can span multiple lines. Continuation lines start with a space. Take only the **first line** (the short description), and strip any trailing comma.
- **Deriving the project path**: For a control file at `<root>/project-name/debian/control`, the project path is `<root>/project-name`. Use `dirname $(dirname <file>)` or equivalent to strip `/debian/control` from the full path. This path tells Kanban where the source code lives on disk.
- If `Source:` is missing, skip that control file and note the warning.
- If two control files have the same `Source:` name, the first one wins; log a warning about the duplicate.

Use a single `grep` pipeline per file for efficiency:

```bash
# Extract Source (package name)
grep -m1 '^Source:' <file> | sed 's/^Source:\s*//'

# Derive project root path (strip /debian/control suffix)
dirname $(dirname <file>)

# Extract Homepage (URL, optional)
grep -m1 '^Homepage:' <file> | sed 's/^Homepage:\s*//'

# Extract Description (short description, first line only)
grep -m1 '^Description:' <file> | sed 's/^Description:\s*//' | sed 's/,.*//'
```

### Step 4: Query existing code projects from Kanban

Fetch all currently-registered code projects:

```bash
curl -s http://localhost:9527/api/v1/code-projects | jq .
```

The response is a JSON array. Each entry has an `id` and `name` field.
Collect all existing names into a set for comparison.

If the Kanban API is unreachable, report the error and stop.

### Step 5: Compare and add new projects

For each discovered project:

- If `name` **already exists** in Kanban → report as "already registered"
- If `name` is **new** → POST to the Kanban API to create it

```bash
curl -s -X POST http://localhost:9527/api/v1/code-projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<project_name>",
    "path": "<project_root_path>",
    "repo_url": "<homepage_url>",
    "description": "<short_description>"
  }' | jq .
```

- Always include the `path` field — it tells Kanban where the project source lives on disk
- Omit the `repo_url` field entirely if the control file had no Homepage
- Omit the `description` field if the control file had no Description

Handle errors gracefully:
- **409 Conflict**: the project already exists (race condition, treat as "already registered")
- **422 Unprocessable**: log the error detail and skip
- **Connection refused / timeout**: report and stop

### Step 6: Report results

Present a summary table to the user:

```
=== Debian Project Sync Results ===
Scanned: /home/user/src
Control files found: 12
Already registered:  8
Newly added:          3
Warnings:             1 (1 missing Source field)

Newly added:
  - dde-calendar    → /home/user/smartos/dde-calendar
                      https://github.com/linuxdeepin/dde-calendar
  - deepin-camera   → /home/user/smartos/deepin-camera
                      https://github.com/linuxdeepin/deepin-camera
  - uos-config      → /home/user/smartos/uos-config
                      (no homepage)

Already registered (skipped):
  - dde-control-center  (/home/user/smartos/dde-control-center)
  - dde-daemon          (/home/user/smartos/dde-daemon)
  - startdde            (/home/user/smartos/startdde)
  ...

Warnings:
  - /path/to/debian/control: missing Source field, skipped
  - /path/to/duplicate/debian/control: duplicate Source "dde-daemon", skipped
```

## Edge Cases

- **Empty directory / no control files**: report and exit cleanly
- **Missing Source field**: skip that file, count as warning
- **Duplicate Source names across files**: use first occurrence, warn about subsequent duplicates
- **Kanban API down**: report connection error, do not proceed to add step
- **Partial failure during addition**: continue adding remaining projects, report each failure
- **Special characters in Source name**: pass through as-is (the API handles validation)

## Dependencies

This skill requires the Kanban API to be running:
- **Kanban server**: `http://localhost:9527`
- **CLI tools**: `find`, `grep`, `sed`, `curl`, `jq`
