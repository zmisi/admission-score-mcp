import type pg from "pg";
import { queryReadOnly } from "../db.js";
import { subjectGroupStem } from "./getMajorByScore.js";
import { resolveAdmissionYear } from "../defaultAdmissionYear.js";

const SCHEMA = "admissions";
const DEFAULT_PROVINCE = "安徽";

export const GET_RANK_BY_SCORE_TOOL = {
  name: "getRankByScore",
  description:
    "Look up the rank (位次) for a given admission score using provincial score segment tables. Defaults to admission year 2025 when year is omitted. subject_group accepts 物理/物理类/物理组 (and 历史 variants); 物理 also matches 2023 理工类, 历史 matches 2023 文史类. Returns rank_min and rank_max for the score band; when they are equal, rank is also set. Each row includes source_url and source_provider from the imported official score segment snapshot.",
  inputSchema: {
    type: "object" as const,
    properties: {
      score: {
        type: "number",
        description: "Admission score",
      },
      province: {
        type: "string",
        description: `Province name (optional, default ${DEFAULT_PROVINCE})`,
      },
      year: {
        type: "number",
        description: "Admission year (optional, default 2025)",
      },
      subject_group: {
        type: "string",
        description:
          "Subject track prefix: 物理 or 历史 (aliases 物理类/物理组/历史类/历史组 accepted; omit for all tracks)",
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
    },
    required: ["score"],
  },
};

export type GetRankByScoreArgs = {
  score: number;
  province: string;
  year?: number;
  subject_group?: string;
};

export type RankByScoreRow = {
  province: string;
  year: number;
  subject_group: string;
  score: number;
  score_display: string;
  score_min: number;
  score_max: number;
  segment_count: number;
  cumulative_count: number;
  rank_min: number | null;
  rank_max: number | null;
  rank: number | null;
  source_url: string | null;
  source_provider: string | null;
  fetched_at: string | null;
};

const SQL = `
SELECT
  s.province,
  s.year,
  s.subject_group,
  r.score_display,
  r.score_min,
  r.score_max,
  r.segment_count,
  r.cumulative_count,
  r.rank_min,
  r.rank_max,
  s.source_url,
  s.source_provider,
  s.fetched_at
FROM ${SCHEMA}.score_segment_row r
JOIN ${SCHEMA}.score_segment_snapshot s ON s.id = r.snapshot_id
WHERE s.province = $1
  AND ($2::int IS NULL OR s.year = $2)
  AND r.score_min IS NOT NULL
  AND r.score_max IS NOT NULL
  AND r.score_min <= $3::int
  AND r.score_max >= $3::int
  AND (
    $4::text IS NULL
    OR s.subject_group LIKE $4 || '%'
    OR ($4 = '物理' AND s.subject_group = '理工类')
    OR ($4 = '历史' AND s.subject_group = '文史类')
  )
ORDER BY s.year DESC, s.subject_group
`;

export function parseGetRankByScoreArgs(
  raw: Record<string, unknown> | undefined,
): GetRankByScoreArgs {
  if (!raw || typeof raw.score !== "number" || Number.isNaN(raw.score)) {
    throw new Error("score is required and must be a number");
  }

  const args: GetRankByScoreArgs = {
    score: raw.score,
    province:
      typeof raw.province === "string" && raw.province.trim() !== ""
        ? raw.province.trim()
        : DEFAULT_PROVINCE,
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

  return args;
}

function normalizeFetchedAt(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const text = String(value).trim();
  return text === "" ? null : text;
}

type RankDbRow = Omit<RankByScoreRow, "score" | "rank"> & {
  fetched_at?: unknown;
};

function toRankRow(score: number, row: RankDbRow): RankByScoreRow {
  const rank =
    row.rank_min !== null && row.rank_max !== null && row.rank_min === row.rank_max
      ? row.rank_min
      : null;
  return {
    ...row,
    score,
    rank,
    source_url: row.source_url ?? null,
    source_provider: row.source_provider ?? null,
    fetched_at: normalizeFetchedAt(row.fetched_at),
  };
}

export async function getRankByScore(
  pool: pg.Pool,
  args: GetRankByScoreArgs,
): Promise<RankByScoreRow[]> {
  const year = resolveAdmissionYear(args.year);
  const rows = await queryReadOnly<RankDbRow>(pool, SQL, [
    args.province,
    year,
    Math.trunc(args.score),
    args.subject_group ?? null,
  ]);

  return rows.map((row) => toRankRow(args.score, row));
}
