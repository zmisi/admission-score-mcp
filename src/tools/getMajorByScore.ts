import type pg from "pg";
import { queryReadOnly } from "../db.js";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const SCHEMA = "admissions";

const SUBJECT_GROUP_ALIASES: Record<string, string> = {
  物理: "物理类",
  物理方向: "物理类",
  历史: "历史类",
  历史方向: "历史类",
};

export const GET_MAJOR_BY_SCORE_TOOL = {
  name: "getMajorByScore",
  description: "Query all majors reachable with the given admission score",
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
          "Subject track: 物理类 or 历史类 (aliases 物理/历史 accepted)",
        enum: ["物理类", "历史类", "物理", "历史", "物理方向", "历史方向"],
      },
      campus: {
        type: "string",
        description: "Campus name, e.g. 合肥校区, 宣城校区 (optional)",
      },
      admission_type: {
        type: "string",
        description: "Admission batch type (optional)",
        enum: ["普通批", "国家专项", "中外合作"],
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
  AND ($4::text IS NULL OR ss.subject_group = $4)
  AND ($5::text IS NULL OR ss.campus = $5)
  AND ($6::text IS NULL OR ss.admission_type = $6)
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

function normalizeSubjectGroup(value: string): string {
  return SUBJECT_GROUP_ALIASES[value] ?? value;
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
    args.subject_group = normalizeSubjectGroup(raw.subject_group.trim());
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
