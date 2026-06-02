# admission-score-mcp

PostgreSQL MCP server for admission score lookups. Design follows `@modelcontextprotocol/server-postgres` (stdio, connection pool, read-only transactions, parameterized SQL).

**Database:** `postgresql://dbagent@127.0.0.1:5432/employees`  
**Schema:** `admissions`

## Tool: `getMajorByScore`

Query all majors reachable with the given admission score (`score_major_line.min_score <= score`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `score` | number | yes | Admission score |
| `province` | string | yes | Province, e.g. `安徽` |
| `year` | number | no | Admission year |
| `subject_group` | string | no | `物理类` / `历史类` (aliases `物理`, `历史`) |
| `campus` | string | no | Campus, e.g. `合肥校区`, `宣城校区` |
| `admission_type` | string | no | `普通批`, `国家专项`, `中外合作` |
| `limit` | number | no | Max rows (default 1000, max 5000) |

Returns `{ count, majors: [...] }` with university, major, score line, and snapshot fields (`year`, `province`, `subject_group`, etc.).

Tables used: `admissions.score_major_line`, `admissions.score_snapshot`, `admissions.university`.

## Setup

```bash
npm install
npm run build
```

```bash
export DATABASE_URL="postgresql://dbagent@127.0.0.1:5432/employees"
node dist/index.js
```

## Cursor MCP config

See `.cursor/mcp.json`.

## Security

Use a read-only DB role (`GRANT SELECT` on `admissions`).
