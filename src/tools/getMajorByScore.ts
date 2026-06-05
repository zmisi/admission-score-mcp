import type pg from "pg";
import { queryReadOnly } from "../db.js";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const SCHEMA = "admissions";

/** Maps user input to a subject prefix for LIKE matching (物理类/物理组 → 物理). */
const SUBJECT_GROUP_STEMS: Record<string, string> = {
  物理: "物理",
  物理类: "物理",
  物理组: "物理",
  物理方向: "物理",
  历史: "历史",
  历史类: "历史",
  历史组: "历史",
  历史方向: "历史",
};

export const GET_MAJOR_BY_SCORE_TOOL = {
  name: "getMajorByScore",
  description:
    "Query all majors where min_score <= the given admission score. Supports multiple universities including 合肥工业大学(HFUT), 合肥大学(HFUU), 安徽大学(AHU), 安徽工业大学(AHUT), 安徽农业大学(AHAU), 安徽理工大学(AUST). Returns data for ALL matching universities — do NOT restrict to just one university unless the user specifies one. subject_group accepts 物理/物理类/物理组 (and 历史 variants) — all map to the same track. admission_type 普通批 also matches DB values 普通 and empty. 冲/稳/保 tier classification is done by the caller by comparing each major's min_score to the user's actual score — call once with the user's score only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      score: {
        type: "number",
        description: "Admission score",
      },
      province: {
        type: "string",
        description: "Province name, e.g. 安徽",
      },
      year: {
        type: "number",
        description: "Admission year (optional)",
      },
      subject_group: {
        type: "string",
        description:
          "Subject track prefix: 物理 or 历史 (aliases 物理类/物理组/历史类/历史组 accepted)",
        enum: [
          "物理类",
          "历史类",
          "物理组",
          "历史组",
          "物理",
          "历史",
          "物理方向",
          "历史方向",
        ],
      },
      campus: {
        type: "string",
        description: "Campus name, e.g. 合肥校区, 宣城校区 (optional)",
      },
      admission_type: {
        type: "string",
        description:
          "Admission batch type (optional). 普通批 also matches 普通 and empty values in DB.",
        enum: ["普通批", "普通", "国家专项", "中外合作", "地方专项"],
      },
      limit: {
        type: "number",
        description: `Max rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
      },
    },
    required: ["score", "province"],
  },
};

export type GetMajorByScoreArgs = {
  score: number;
  province: string;
  year?: number;
  subject_group?: string;
  campus?: string;
  admission_type?: string;
  limit?: number;
};

export type MajorByScoreRow = {
  university_code: string;
  university_name: string;
  major_name: string;
  min_score: string;
  min_rank: number | null;
  max_score: string | null;
  avg_score: string | null;
  subject_requirement: string | null;
  year: number;
  province: string;
  subject_group: string;
  campus: string;
  admission_type: string;
};

const SQL = `
SELECT
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
  ss.campus,
  ss.admission_type
FROM ${SCHEMA}.score_major_line sml
JOIN ${SCHEMA}.score_snapshot ss ON ss.id = sml.snapshot_id
JOIN ${SCHEMA}.university u ON u.code = ss.university_code
WHERE sml.min_score IS NOT NULL
  AND sml.min_score <= $1::numeric
  AND ss.province = $2
  AND ($3::int IS NULL OR ss.year = $3)
  AND ($4::text IS NULL OR ss.subject_group LIKE $4 || '%')
  AND ($5::text IS NULL OR ss.campus = $5)
  AND (
    $6::text IS NULL
    OR ss.admission_type = $6
    OR (
      $6 IN ('普通批', '普通')
      AND (
        ss.admission_type IN ('普通批', '普通')
        OR ss.admission_type IS NULL
        OR ss.admission_type = ''
      )
    )
  )
ORDER BY sml.min_score DESC, u.name, sml.major_name
LIMIT $7
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

/** Exported for tests. Strips 类/组 suffix and maps aliases to a LIKE prefix. */
export function subjectGroupStem(value: string): string {
  const trimmed = value.trim();
  return SUBJECT_GROUP_STEMS[trimmed] ?? trimmed.replace(/[类组]$/, "");
}

export function parseGetMajorByScoreArgs(
  raw: Record<string, unknown> | undefined,
): GetMajorByScoreArgs {
  if (!raw || typeof raw.score !== "number" || Number.isNaN(raw.score)) {
    throw new Error("score is required and must be a number");
  }

  const args: GetMajorByScoreArgs = {
    score: raw.score,
    province: requireNonEmptyString(raw, "province"),
  };

  if (raw.year !== undefined) {
    if (typeof raw.year !== "number" || Number.isNaN(raw.year)) {
      throw new Error("year must be a number");
    }
    args.year = raw.year;
  }

  if (raw.subject_group !== undefined) {
    if (typeof raw.subject_group !== "string" || raw.subject_group.trim() === "") {
      throw new Error("subject_group must be a non-empty string");
    }
    args.subject_group = subjectGroupStem(raw.subject_group);
  }

  if (raw.campus !== undefined) {
    if (typeof raw.campus !== "string" || raw.campus.trim() === "") {
      throw new Error("campus must be a non-empty string");
    }
    args.campus = raw.campus.trim();
  }

  if (raw.admission_type !== undefined) {
    if (typeof raw.admission_type !== "string" || raw.admission_type.trim() === "") {
      throw new Error("admission_type must be a non-empty string");
    }
    args.admission_type = raw.admission_type.trim();
  }

  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || Number.isNaN(raw.limit)) {
      throw new Error("limit must be a number");
    }
    args.limit = raw.limit;
  }

  return args;
}

export async function getMajorByScore(
  pool: pg.Pool,
  args: GetMajorByScoreArgs,
): Promise<MajorByScoreRow[]> {
  const limit = Math.min(
    Math.max(1, args.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  return queryReadOnly<MajorByScoreRow>(pool, SQL, [
    args.score,
    args.province,
    args.year ?? null,
    args.subject_group ?? null,
    args.campus ?? null,
    args.admission_type ?? null,
    limit,
  ]);
}
