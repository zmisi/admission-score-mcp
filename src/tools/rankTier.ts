/** 冲/稳/保 tier offsets relative to user rank (see volunteer-strategy-rank-10000 guide). */
export const RANK_TIER_OFFSETS = {
  /** 冲 upper bound: majors with min_rank >= userRank - REACH_HIGH */
  REACH_HIGH: 3000,
  /** 冲/稳 boundary at userRank - REACH_LOW */
  REACH_LOW: 500,
  /** 稳/保 boundary at userRank + STEADY_LOW */
  STEADY_LOW: 3000,
  /** 保 default lower bound at userRank + SAFE_LOW */
  SAFE_LOW: 6000,
  /** 保 extended lower bound when extend_safe is true */
  SAFE_EXTEND: 10000,
} as const;

export type RankTier = "冲" | "稳" | "保";

export type RankTierRange = {
  min_rank: number;
  max_rank: number;
};

export type RankTierRanges = Record<RankTier, RankTierRange>;

/** Half-open intervals: 冲 [R-3000, R-500), 稳 [R-500, R+3000), 保 [R+3000, R+safeMax]. */
export function computeRankTierRanges(
  userRank: number,
  extendSafe = false,
): RankTierRanges {
  const safeMax = extendSafe
    ? userRank + RANK_TIER_OFFSETS.SAFE_EXTEND
    : userRank + RANK_TIER_OFFSETS.SAFE_LOW;
  return {
    冲: {
      min_rank: userRank - RANK_TIER_OFFSETS.REACH_HIGH,
      max_rank: userRank - RANK_TIER_OFFSETS.REACH_LOW - 1,
    },
    稳: {
      min_rank: userRank - RANK_TIER_OFFSETS.REACH_LOW,
      max_rank: userRank + RANK_TIER_OFFSETS.STEADY_LOW - 1,
    },
    保: {
      min_rank: userRank + RANK_TIER_OFFSETS.STEADY_LOW,
      max_rank: safeMax,
    },
  };
}

export function queryRankBounds(
  userRank: number,
  extendSafe = false,
): { min: number; max: number } {
  const ranges = computeRankTierRanges(userRank, extendSafe);
  return {
    min: ranges.冲.min_rank,
    max: ranges.保.max_rank,
  };
}

export function classifyRankTier(
  userRank: number,
  minRank: number,
  extendSafe = false,
): RankTier | null {
  const ranges = computeRankTierRanges(userRank, extendSafe);
  if (minRank >= ranges.冲.min_rank && minRank <= ranges.冲.max_rank) {
    return "冲";
  }
  if (minRank >= ranges.稳.min_rank && minRank <= ranges.稳.max_rank) {
    return "稳";
  }
  if (minRank >= ranges.保.min_rank && minRank <= ranges.保.max_rank) {
    return "保";
  }
  return null;
}
