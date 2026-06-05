import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseGetMajorByScoreArgs,
  subjectGroupStem,
} from "./getMajorByScore.js";

describe("subjectGroupStem", () => {
  it("maps 物理 variants to 物理 prefix", () => {
    assert.equal(subjectGroupStem("物理"), "物理");
    assert.equal(subjectGroupStem("物理类"), "物理");
    assert.equal(subjectGroupStem("物理组"), "物理");
    assert.equal(subjectGroupStem("物理方向"), "物理");
  });

  it("maps 历史 variants to 历史 prefix", () => {
    assert.equal(subjectGroupStem("历史"), "历史");
    assert.equal(subjectGroupStem("历史类"), "历史");
    assert.equal(subjectGroupStem("历史组"), "历史");
  });
});

describe("parseGetMajorByScoreArgs", () => {
  it("normalizes subject_group to stem before query", () => {
    const args = parseGetMajorByScoreArgs({
      score: 580,
      province: "安徽",
      subject_group: "物理",
      admission_type: "普通批",
      year: 2025,
    });
    assert.equal(args.subject_group, "物理");
    assert.equal(args.admission_type, "普通批");
  });
});
