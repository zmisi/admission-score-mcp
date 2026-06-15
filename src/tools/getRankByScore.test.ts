import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGetRankByScoreArgs } from "./getRankByScore.js";

describe("parseGetRankByScoreArgs", () => {
  it("requires only score and defaults province to 安徽", () => {
    const args = parseGetRankByScoreArgs({ score: 600 });
    assert.equal(args.score, 600);
    assert.equal(args.province, "安徽");
    assert.equal(args.year, undefined);
    assert.equal(args.subject_group, undefined);
  });

  it("normalizes subject_group to stem", () => {
    const args = parseGetRankByScoreArgs({
      score: 580,
      subject_group: "物理类",
      year: 2024,
      province: "安徽",
    });
    assert.equal(args.subject_group, "物理");
    assert.equal(args.year, 2024);
  });
});
