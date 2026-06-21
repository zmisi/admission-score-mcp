import type pg from "pg";
import { queryReadOnly } from "../db.js";
import {
  subjectGroupStem,
  type MajorByScoreRow,
} from "./getMajorByScore.js";
import {
  classifyRankTier,
  computeRankTierRanges,
  queryRankBounds,
  RANK_TIER_OFFSETS,
  type RankTier,
  type RankTierRanges,
} from "./rankTier.js";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const SCHEMA = "admissions";

export const GET_MAJOR_BY_RANK_TOOL = {
  name: "getMajorByRank",
  description:
    "Query majors for 冲/稳/保 volunteer tiers by admission rank (位次). Tier ranges follow the rank-based gradient guide: for user rank R, 冲 covers min_rank R-3000~R-500 (reach), 稳 covers R-500~R+3000 (match), 保 covers R+3000~R+6000 (safety; extend to R+10000 with extend_safe). Lower min_rank means a harder reach. Supports multiple universities including 合肥工业大学(HFUT), 合肥大学(HFUU), 安徽大学(AHU), 安徽工业大学(AHUT), 安徽农业大学(AHAU), 安徽理工大学(AUST), 安徽师范大学(AHNU). Returns data for ALL matching universities — do NOT restrict to just one unless the user specifies one. subject_group accepts 物理/物理类/物理组 (and 历史 variants). admission_type 普通批 also matches DB values 普通 and empty. Each major includes a tier field; response also groups majors_by_tier.",
  inputSchema: {
    type: "object" as const,
    properties: {
      rank: {
        type: "number",
        description: "User admission rank (位次); lower is better",
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
      tier: {
        type: "string",
        description: "Return only one tier (optional)",
        enum: ["冲", "稳", "保"],
      },
      extend_safe: {
        type: "boolean",
        description:
          "Extend 保 upper bound from R+6000 to R+10000 (optional, default false)",
      },
      limit: {
        type: "number",
        description: `Max rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
      },
    },
    required: ["rank", "province"],
  },
};

export type GetMajorByRankArgs = {
  rank: number;
  province: string;
  year?: number;
  subject_group?: string;
  campus?: string;
  admission_type?: string;
  tier?: RankTier;
  extend_safe?: boolean;
  limit?: number;
};

export type MajorByRankRow = MajorByScoreRow & {
  tier: RankTier;
};

export type GetMajorByRankResult = {
  user_rank: number;
  tier_offsets: typeof RANK_TIER_OFFSETS;
  tier_ranges: RankTierRanges;
  extend_safe: boolean;
  tier_counts: Record<RankTier, number>;
  count: number;
  majors_by_tier: Record<RankTier, MajorByRankRow[]>;
  majors: MajorByRankRow[];
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
  ss.admission_type,
  cat.discipline_category,
  cat.discipline_groups
FROM ${SCHEMA}.score_major_line sml
JOIN ${SCHEMA}.score_snapshot ss ON ss.id = sml.snapshot_id
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
WHERE sml.min_rank IS NOT NULL
  AND sml.min_rank >= $1::int
  AND sml.min_rank <= $2::int
  AND ss.province = $3
  AND ($4::int IS NULL OR ss.year = $4)
  AND (
    $5::text IS NULL
    OR ss.subject_group LIKE $5 || '%'
    OR ss.subject_group LIKE '%' || $5 || '%'
    OR ($5 = '物理' AND ss.subject_group = '理工类')
    OR ($5 = '历史' AND ss.subject_group = '文史类')
  )
  AND ($6::text IS NULL OR ss.campus = $6)
  AND (
    $7::text IS NULL
    OR ss.admission_type = $7
    OR (
      $7 IN ('普通批', '普通')
      AND (
        ss.admission_type IN ('普通批', '普通')
        OR ss.admission_type IS NULL
        OR ss.admission_type = ''
      )
    )
  )
ORDER BY sml.min_rank ASC, u.name, sml.major_name
LIMIT $8
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

export function parseGetMajorByRankArgs(
  raw: Record<string, unknown> | undefined,
): GetMajorByRankArgs {
  if (!raw || typeof raw.rank !== "number" || Number.isNaN(raw.rank)) {
    throw new Error("rank is required and must be a number");
  }
  if (raw.rank <= 0 || !Number.isInteger(raw.rank)) {
    throw new Error("rank must be a positive integer");
  }

  const args: GetMajorByRankArgs = {
    rank: raw.rank,
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

  if (raw.tier !== undefined) {
    if (raw.tier !== "冲" && raw.tier !== "稳" && raw.tier !== "保") {
      throw new Error('tier must be one of "冲", "稳", "保"');
    }
    args.tier = raw.tier;
  }

  if (raw.extend_safe !== undefined) {
    if (typeof raw.extend_safe !== "boolean") {
      throw new Error("extend_safe must be a boolean");
    }
    args.extend_safe = raw.extend_safe;
  }

  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || Number.isNaN(raw.limit)) {
      throw new Error("limit must be a number");
    }
    args.limit = raw.limit;
  }

  return args;
}

function emptyMajorsByTier(): Record<RankTier, MajorByRankRow[]> {
  return { 冲: [], 稳: [], 保: [] };
}

export function buildMajorByRankResult(
  userRank: number,
  rows: MajorByScoreRow[],
  extendSafe = false,
  tierFilter?: RankTier,
): GetMajorByRankResult {
  const tierRanges = computeRankTierRanges(userRank, extendSafe);
  const majorsByTier = emptyMajorsByTier();
  const tierCounts: Record<RankTier, number> = { 冲: 0, 稳: 0, 保: 0 };
  const majors: MajorByRankRow[] = [];

  for (const row of rows) {
    if (row.min_rank == null) {
      continue;
    }
    const tier = classifyRankTier(userRank, row.min_rank, extendSafe);
    if (tier == null) {
      continue;
    }
    if (tierFilter != null && tier !== tierFilter) {
      continue;
    }
    const enriched: MajorByRankRow = { ...row, tier };
    majors.push(enriched);
    majorsByTier[tier].push(enriched);
    tierCounts[tier] += 1;
  }

  return {
    user_rank: userRank,
    tier_offsets: RANK_TIER_OFFSETS,
    tier_ranges: tierRanges,
    extend_safe: extendSafe,
    tier_counts: tierCounts,
    count: majors.length,
    majors_by_tier: majorsByTier,
    majors,
  };
}

export async function getMajorByRank(
  pool: pg.Pool,
  args: GetMajorByRankArgs,
): Promise<GetMajorByRankResult> {
  const extendSafe = args.extend_safe ?? false;
  const bounds = queryRankBounds(args.rank, extendSafe);
  const limit = Math.min(
    Math.max(1, args.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const rows = await queryReadOnly<MajorByScoreRow>(pool, SQL, [
    bounds.min,
    bounds.max,
    args.province,
    args.year ?? null,
    args.subject_group ?? null,
    args.campus ?? null,
    args.admission_type ?? null,
    limit,
  ]);

  return buildMajorByRankResult(args.rank, rows, extendSafe, args.tier);
}
