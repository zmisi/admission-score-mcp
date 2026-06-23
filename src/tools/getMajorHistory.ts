import type pg from "pg";
import { queryReadOnly } from "../db.js";
import {
  MAIN_CAMPUS_ALIASES,
  planMajorLateralSql,
} from "./planMajorMatch.js";
import type { MajorByScoreRow } from "./getMajorByScore.js";
import { subjectGroupStem } from "./getMajorByScore.js";
import { resolveAdmissionYear } from "../defaultAdmissionYear.js";

const SCHEMA = "admissions";
const MAX_MAJORS = 500;
const MAX_YEARS = 5;
const MAIN_CAMPUS_SQL = MAIN_CAMPUS_ALIASES.map((c) => `'${c}'`).join(", ");

function majorNameMatchSql(majorColumn: string): string {
  return `(
    ${majorColumn} = r.major_name
    OR ${majorColumn} LIKE r.major_name || '(%'
    OR r.major_name LIKE ${majorColumn} || '(%'
    OR replace(replace(${majorColumn}, '与', ''), '及', '') =
       replace(replace(r.major_name, '与', ''), '及', '')
    OR (
      length(r.major_name) >= 4
      AND ${majorColumn} LIKE '%' || r.major_name || '%'
    )
    OR (
      length(${majorColumn}) >= 4
      AND r.major_name LIKE '%' || ${majorColumn} || '%'
    )
  )`;
}

function subjectGroupMatchSql(snapshotColumn: string): string {
  return `(
    r.subject_group IS NULL
    OR r.subject_group = ''
    OR ${snapshotColumn} LIKE r.subject_group || '%'
    OR ${snapshotColumn} LIKE '%' || r.subject_group || '%'
    OR (r.subject_group = '物理' AND ${snapshotColumn} = '理工类')
    OR (r.subject_group = '历史' AND ${snapshotColumn} = '文史类')
  )`;
}

function admissionTypeMatchSql(snapshotColumn: string): string {
  return `(
    r.admission_type IS NULL
    OR r.admission_type = ''
    OR ${snapshotColumn} = r.admission_type
    OR (
      r.admission_type IN ('普通批', '普通')
      AND (
        ${snapshotColumn} IN ('普通批', '普通')
        OR ${snapshotColumn} IS NULL
        OR ${snapshotColumn} = ''
      )
    )
    OR (
      r.admission_type IN ('国家专项', '地方专项')
      AND ${snapshotColumn} = r.admission_type
    )
    OR (
      r.admission_type = '艺术类'
      AND ${snapshotColumn} IN ('艺术类', '普通批', '普通')
    )
  )`;
}

/** When the requested campus has no row for that year, allow another campus (e.g. 合肥校区 → 校本部). */
function campusMatchSql(dbCampusExpr: string, noCampusDataExistsSql: string): string {
  return `(
    r.campus IS NULL
    OR r.campus = ''
    OR r.campus = '-'
    OR COALESCE(NULLIF(${dbCampusExpr}, ''), '') = COALESCE(NULLIF(r.campus, ''), '')
    OR (
      COALESCE(NULLIF(r.campus, ''), '') IN (${MAIN_CAMPUS_SQL})
      AND COALESCE(NULLIF(${dbCampusExpr}, ''), '') IN ('', ${MAIN_CAMPUS_SQL})
    )
    OR (
      COALESCE(NULLIF(${dbCampusExpr}, ''), '') IN (${MAIN_CAMPUS_SQL})
      AND COALESCE(NULLIF(r.campus, ''), '') IN ('', ${MAIN_CAMPUS_SQL})
    )
    OR (
      r.campus IS NOT NULL
      AND r.campus <> ''
      AND r.campus <> '-'
      AND ${noCampusDataExistsSql}
    )
  )`;
}

const SCORE_CAMPUS_FALLBACK = `
NOT EXISTS (
  SELECT 1
  FROM ${SCHEMA}.score_snapshot ss_c
  JOIN ${SCHEMA}.score_major_line sml_c ON sml_c.snapshot_id = ss_c.id
  WHERE ss_c.university_code = r.university_code
    AND ss_c.province = $2
    AND ss_c.year = r.year
    AND COALESCE(NULLIF(ss_c.campus, ''), '') = COALESCE(NULLIF(r.campus, ''), '')
    AND sml_c.min_score IS NOT NULL
    AND ${majorNameMatchSql("sml_c.major_name")}
    AND ${subjectGroupMatchSql("ss_c.subject_group")}
    AND ${admissionTypeMatchSql("ss_c.admission_type")}
)`;

const PLAN_CAMPUS_FALLBACK = `
NOT EXISTS (
  SELECT 1
  FROM ${SCHEMA}.plan_snapshot ps_c
  JOIN ${SCHEMA}.plan_major_line pml_c ON pml_c.snapshot_id = ps_c.id
  WHERE ps_c.university_code = r.university_code
    AND ps_c.province = $2
    AND ps_c.year = r.year
    AND COALESCE(NULLIF(ps_c.campus, ''), '') = COALESCE(NULLIF(r.campus, ''), '')
    AND ${majorNameMatchSql("pml_c.major_name")}
    AND ${subjectGroupMatchSql("ps_c.subject_group")}
    AND ${admissionTypeMatchSql("ps_c.admission_type")}
)`;

export const GET_MAJOR_HISTORY_TOOL = {
  name: "getMajorHistory",
  description:
    "Look up historical admission score/plan rows for specific university majors. Used to show prior-year plan_count, min_score, and min_rank for majors already identified in the current admission year.",
  inputSchema: {
    type: "object" as const,
    properties: {
      province: {
        type: "string",
        description: "Province name, e.g. 安徽",
      },
      years: {
        type: "array",
        items: { type: "number" },
        description:
          "Admission years to fetch (optional). Defaults to two years before the base year.",
      },
      base_year: {
        type: "number",
        description:
          "Current query year used to derive default history years (optional, default 2025)",
      },
      majors: {
        type: "array",
        description: "Majors to look up",
        items: {
          type: "object",
          properties: {
            university_code: { type: "string" },
            major_name: { type: "string" },
            campus: { type: "string" },
            subject_group: { type: "string" },
            admission_type: { type: "string" },
          },
          required: ["university_code", "major_name"],
        },
      },
    },
    required: ["province", "majors"],
  },
};

export type MajorHistoryLookup = {
  university_code: string;
  major_name: string;
  campus?: string;
  subject_group?: string;
  admission_type?: string;
};

export type GetMajorHistoryArgs = {
  province: string;
  majors: MajorHistoryLookup[];
  years?: number[];
  base_year?: number;
};

export type MajorHistoryRow = MajorByScoreRow & {
  lookup_university_code: string;
  lookup_major_name: string;
};

const SQL = `
WITH requests AS (
  SELECT *
  FROM jsonb_to_recordset($1::jsonb) AS x(
    university_code text,
    major_name text,
    campus text,
    subject_group text,
    admission_type text,
    year int
  )
)
SELECT
  r.university_code AS lookup_university_code,
  r.major_name AS lookup_major_name,
  r.year AS lookup_year,
  u.code AS university_code,
  u.name AS university_name,
  sml.major_name,
  sml.min_score,
  sml.min_rank,
  sml.max_score,
  sml.avg_score,
  sml.subject_requirement,
  ss.year,
  ss.province,
  ss.subject_group,
  COALESCE(NULLIF(plan.plan_campus, ''), NULLIF(ss.campus, ''), '') AS campus,
  ss.admission_type,
  cat.discipline_category,
  cat.discipline_groups,
  plan.plan_count
FROM requests r
JOIN ${SCHEMA}.score_snapshot ss
  ON ss.university_code = r.university_code
 AND ss.province = $2
 AND ss.year = r.year
JOIN ${SCHEMA}.score_major_line sml ON sml.snapshot_id = ss.id
JOIN ${SCHEMA}.university u ON u.code = ss.university_code
LEFT JOIN LATERAL (
  SELECT mc.discipline_category, mc.discipline_groups
  FROM ${SCHEMA}.major_catalog mc
  WHERE sml.major_name = mc.major_name
     OR sml.major_name LIKE mc.major_name || '(%'
     OR (
       length(mc.major_name) >= 4
       AND sml.major_name LIKE '%' || mc.major_name || '%'
     )
  ORDER BY
    CASE
      WHEN sml.major_name = mc.major_name THEN 0
      WHEN sml.major_name LIKE mc.major_name || '(%' THEN 1
      ELSE 2
    END,
    length(mc.major_name) DESC
  LIMIT 1
) cat ON true
${planMajorLateralSql(3)}
WHERE sml.min_score IS NOT NULL
  AND ${majorNameMatchSql("sml.major_name")}
  AND ${subjectGroupMatchSql("ss.subject_group")}
  AND ${campusMatchSql("ss.campus", SCORE_CAMPUS_FALLBACK)}
  AND ${admissionTypeMatchSql("ss.admission_type")}
ORDER BY
  r.university_code,
  r.major_name,
  r.year DESC,
  CASE
    WHEN COALESCE(NULLIF(ss.campus, ''), '') = COALESCE(NULLIF(r.campus, ''), '') THEN 0
    ELSE 1
  END,
  CASE
    WHEN sml.major_name = r.major_name THEN 0
    WHEN sml.major_name LIKE r.major_name || '(%' THEN 1
    WHEN r.major_name LIKE sml.major_name || '(%' THEN 2
    ELSE 3
  END,
  sml.min_score DESC NULLS LAST
`;

/** Plan-only lookup for years with plan_snapshot but no score lines yet (e.g. 2026). */
const PLAN_ONLY_SQL = `
WITH requests AS (
  SELECT *
  FROM jsonb_to_recordset($1::jsonb) AS x(
    university_code text,
    major_name text,
    campus text,
    subject_group text,
    admission_type text,
    year int
  )
)
SELECT
  r.university_code AS lookup_university_code,
  r.major_name AS lookup_major_name,
  r.year AS lookup_year,
  u.code AS university_code,
  u.name AS university_name,
  pml.major_name,
  NULL::text AS min_score,
  NULL::int AS min_rank,
  NULL::text AS max_score,
  NULL::text AS avg_score,
  pml.subject_requirement,
  ps.year,
  ps.province,
  ps.subject_group,
  CASE
    WHEN COALESCE(NULLIF(ps.campus, ''), '') = '' THEN '校本部'
    ELSE ps.campus
  END AS campus,
  ps.admission_type,
  cat.discipline_category,
  cat.discipline_groups,
  pml.plan_count
FROM requests r
JOIN ${SCHEMA}.plan_snapshot ps
  ON ps.university_code = r.university_code
 AND ps.province = $2
 AND ps.year = r.year
JOIN ${SCHEMA}.plan_major_line pml ON pml.snapshot_id = ps.id
JOIN ${SCHEMA}.university u ON u.code = ps.university_code
LEFT JOIN LATERAL (
  SELECT mc.discipline_category, mc.discipline_groups
  FROM ${SCHEMA}.major_catalog mc
  WHERE pml.major_name = mc.major_name
     OR pml.major_name LIKE mc.major_name || '(%'
     OR (
       length(mc.major_name) >= 4
       AND pml.major_name LIKE '%' || mc.major_name || '%'
     )
  ORDER BY
    CASE
      WHEN pml.major_name = mc.major_name THEN 0
      WHEN pml.major_name LIKE mc.major_name || '(%' THEN 1
      ELSE 2
    END,
    length(mc.major_name) DESC
  LIMIT 1
) cat ON true
WHERE ${majorNameMatchSql("pml.major_name")}
  AND ${subjectGroupMatchSql("ps.subject_group")}
  AND ${campusMatchSql("ps.campus", PLAN_CAMPUS_FALLBACK)}
  AND ${admissionTypeMatchSql("ps.admission_type")}
ORDER BY
  r.university_code,
  r.major_name,
  r.year DESC,
  CASE
    WHEN COALESCE(NULLIF(ps.campus, ''), '') = COALESCE(NULLIF(r.campus, ''), '') THEN 0
    ELSE 1
  END,
  CASE
    WHEN pml.major_name = r.major_name THEN 0
    WHEN pml.major_name LIKE r.major_name || '(%' THEN 1
    WHEN r.major_name LIKE pml.major_name || '(%' THEN 2
    ELSE 3
  END,
  pml.plan_count DESC NULLS LAST
`;

function requireNonEmptyString(
  raw: Record<string, unknown>,
  key: string,
): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required and must be a non-empty string`);
  }
  return value.trim();
}

function defaultHistoryYears(baseYear: number): number[] {
  return [baseYear - 1, baseYear - 2, baseYear + 1];
}

function parseMajor(raw: unknown): MajorHistoryLookup {
  if (!raw || typeof raw !== "object") {
    throw new Error("majors items must be objects");
  }
  const record = raw as Record<string, unknown>;
  const lookup: MajorHistoryLookup = {
    university_code: requireNonEmptyString(record, "university_code"),
    major_name: requireNonEmptyString(record, "major_name"),
  };
  if (record.campus !== undefined) {
    if (typeof record.campus !== "string") {
      throw new Error("campus must be a string");
    }
    lookup.campus = record.campus.trim();
  }
  if (record.subject_group !== undefined) {
    if (typeof record.subject_group !== "string") {
      throw new Error("subject_group must be a string");
    }
    lookup.subject_group = subjectGroupStem(record.subject_group);
  }
  if (record.admission_type !== undefined) {
    if (typeof record.admission_type !== "string") {
      throw new Error("admission_type must be a string");
    }
    lookup.admission_type = record.admission_type.trim();
  }
  return lookup;
}

export function parseGetMajorHistoryArgs(
  raw: Record<string, unknown> | undefined,
): GetMajorHistoryArgs {
  if (!raw) {
    throw new Error("arguments are required");
  }
  const province = requireNonEmptyString(raw, "province");
  if (!Array.isArray(raw.majors) || raw.majors.length === 0) {
    throw new Error("majors is required and must be a non-empty array");
  }
  if (raw.majors.length > MAX_MAJORS) {
    throw new Error(`majors exceeds max ${MAX_MAJORS}`);
  }

  const baseYear =
    raw.base_year === undefined
      ? resolveAdmissionYear(undefined)
      : typeof raw.base_year === "number" && !Number.isNaN(raw.base_year)
        ? raw.base_year
        : (() => {
            throw new Error("base_year must be a number");
          })();

  let years: number[];
  if (raw.years === undefined) {
    years = defaultHistoryYears(baseYear);
  } else if (!Array.isArray(raw.years)) {
    throw new Error("years must be an array of numbers");
  } else {
    years = raw.years.map((year) => {
      if (typeof year !== "number" || Number.isNaN(year)) {
        throw new Error("years must contain numbers only");
      }
      return year;
    });
  }
  if (years.length === 0) {
    years = defaultHistoryYears(baseYear);
  }
  if (years.length > MAX_YEARS) {
    throw new Error(`years exceeds max ${MAX_YEARS}`);
  }

  return {
    province,
    majors: raw.majors.map(parseMajor),
    years,
    base_year: baseYear,
  };
}

type RequestRow = MajorHistoryLookup & { year: number };

function buildRequestRows(
  majors: MajorHistoryLookup[],
  years: number[],
): RequestRow[] {
  const rows: RequestRow[] = [];
  for (const major of majors) {
    for (const year of years) {
      rows.push({ ...major, year });
    }
  }
  return rows;
}

function mergeBestByLookupKey(
  rows: (MajorHistoryRow & { lookup_year: number })[],
  bestByKey: Map<string, MajorHistoryRow>,
): void {
  for (const row of rows) {
    const key = `${row.lookup_university_code}\u0000${row.lookup_major_name}\u0000${row.lookup_year}`;
    if (!bestByKey.has(key)) {
      bestByKey.set(key, row);
    }
  }
}

export async function getMajorHistory(
  pool: pg.Pool,
  args: GetMajorHistoryArgs,
): Promise<MajorHistoryRow[]> {
  const requestRows = buildRequestRows(
    args.majors,
    args.years ??
      defaultHistoryYears(
        args.base_year ?? resolveAdmissionYear(undefined),
      ),
  );
  const requestJson = JSON.stringify(requestRows);
  const scoreRows = await queryReadOnly<
    MajorHistoryRow & { lookup_year: number }
  >(pool, SQL, [requestJson, args.province, null]);
  const planRows = await queryReadOnly<
    MajorHistoryRow & { lookup_year: number }
  >(pool, PLAN_ONLY_SQL, [requestJson, args.province]);

  const bestByKey = new Map<string, MajorHistoryRow>();
  mergeBestByLookupKey(scoreRows, bestByKey);
  mergeBestByLookupKey(planRows, bestByKey);
  return Array.from(bestByKey.values());
}
