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
| `subject_group` | string | no | `物理` / `历史` prefix match; aliases `物理类`, `物理组`, `历史类`, `历史组` |
| `campus` | string | no | Campus, e.g. `合肥校区`, `宣城校区` |
| `admission_type` | string | no | `普通批` (also matches DB `普通` and empty), `国家专项`, `中外合作`, `地方专项` |
| `limit` | number | no | Max rows (default 1000, max 5000) |

Returns `{ count, majors: [...] }` with university, major, score line, snapshot fields (`year`, `province`, `subject_group`, etc.), and `plan_count` (integer or `null` when no matching plan row exists).

**Plan year:** when `year` is provided in the tool args, `plan_count` is looked up from `plan_snapshot` for that year (plans may be published before score lines). When `year` is omitted, plan lookup uses each score row's `ss.year`.

Tables used: `admissions.score_major_line`, `admissions.score_snapshot`, `admissions.university`, `admissions.plan_snapshot`, `admissions.plan_major_line`.

## Tool: `getMajorByRank`

Same major row shape as `getMajorByScore`, plus `tier` and `majors_by_tier` grouping for 冲/稳/保. Each major includes `plan_count` with the same plan-year rules as above.

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
