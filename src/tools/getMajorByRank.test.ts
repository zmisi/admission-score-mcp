import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMajorByRankResult,
  parseGetMajorByRankArgs,
} from "./getMajorByRank.js";
import {
  classifyRankTier,
  computeRankTierRanges,
  queryRankBounds,
} from "./rankTier.js";

describe("computeRankTierRanges", () => {
  it("matches volunteer-strategy-rank-10000 guide for rank 10000", () => {
    const ranges = computeRankTierRanges(10000);
    assert.deepEqual(ranges.冲, { min_rank: 7000, max_rank: 9499 });
    assert.deepEqual(ranges.稳, { min_rank: 9500, max_rank: 12999 });
    assert.deepEqual(ranges.保, { min_rank: 13000, max_rank: 16000 });
  });

  it("extends 保 to R+10000 when extend_safe is true", () => {
    const ranges = computeRankTierRanges(10000, true);
    assert.equal(ranges.保.max_rank, 20000);
  });
});

describe("classifyRankTier", () => {
  it("classifies boundary ranks for user rank 10000", () => {
    assert.equal(classifyRankTier(10000, 7000), "冲");
    assert.equal(classifyRankTier(10000, 9499), "冲");
    assert.equal(classifyRankTier(10000, 9500), "稳");
    assert.equal(classifyRankTier(10000, 12999), "稳");
    assert.equal(classifyRankTier(10000, 13000), "保");
    assert.equal(classifyRankTier(10000, 16000), "保");
    assert.equal(classifyRankTier(10000, 16001), null);
    assert.equal(classifyRankTier(10000, 6999), null);
  });
});

describe("queryRankBounds", () => {
  it("spans 冲 through 保 for default safe range", () => {
    assert.deepEqual(queryRankBounds(10000), { min: 7000, max: 16000 });
  });
});

describe("parseGetMajorByRankArgs", () => {
  it("parses rank and optional tier filter", () => {
    const args = parseGetMajorByRankArgs({
      rank: 10000,
      province: "安徽",
      subject_group: "物理",
      tier: "稳",
      extend_safe: true,
    });
    assert.equal(args.rank, 10000);
    assert.equal(args.subject_group, "物理");
    assert.equal(args.tier, "稳");
    assert.equal(args.extend_safe, true);
  });

  it("rejects non-integer rank", () => {
    assert.throws(
      () => parseGetMajorByRankArgs({ rank: 10000.5, province: "安徽" }),
      /positive integer/,
    );
  });
});

describe("buildMajorByRankResult", () => {
  const sampleRow = (name: string, minRank: number) => ({
    university_code: "hfut",
    university_name: "合肥工业大学",
    major_name: name,
    min_score: "630",
    min_rank: minRank,
    max_score: null,
    avg_score: null,
    subject_requirement: null,
    year: 2025,
    province: "安徽",
    subject_group: "物理类",
    campus: "合肥校区",
    admission_type: "普通批",
    discipline_category: null,
    discipline_groups: null,
  });

  it("groups majors into tiers", () => {
    const result = buildMajorByRankResult(10000, [
      sampleRow("冲高专业", 8000),
      sampleRow("稳妥专业", 11000),
      sampleRow("保底专业", 15000),
      sampleRow("超出范围", 17000),
    ]);

    assert.equal(result.tier_counts.冲, 1);
    assert.equal(result.tier_counts.稳, 1);
    assert.equal(result.tier_counts.保, 1);
    assert.equal(result.count, 3);
    assert.equal(result.majors_by_tier.冲[0]?.major_name, "冲高专业");
    assert.equal(result.majors_by_tier.稳[0]?.major_name, "稳妥专业");
    assert.equal(result.majors_by_tier.保[0]?.major_name, "保底专业");
  });

  it("filters to a single tier when requested", () => {
    const result = buildMajorByRankResult(
      10000,
      [sampleRow("冲高专业", 8000), sampleRow("稳妥专业", 11000)],
      false,
      "稳",
    );
    assert.equal(result.count, 1);
    assert.equal(result.majors[0]?.tier, "稳");
  });
});
