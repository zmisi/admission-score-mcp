import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  admissionTypesCompatible,
  majorNameMatchRank,
  planMajorLateralSql,
} from "./planMajorMatch.js";

describe("majorNameMatchRank", () => {
  it("prefers exact match over prefix and contains", () => {
    assert.equal(majorNameMatchRank("软件工程", "软件工程"), 0);
    assert.equal(majorNameMatchRank("软件工程(宣城)", "软件工程"), 1);
    assert.equal(majorNameMatchRank("数字媒体技术", "数字媒体与技术"), 2);
    assert.equal(majorNameMatchRank("计算机科学与技术", "计算机科学"), 3);
    assert.equal(majorNameMatchRank("法学", "软件工程"), null);
  });
});

describe("admissionTypesCompatible", () => {
  it("treats 普通批/普通/本科批/empty as compatible", () => {
    assert.equal(admissionTypesCompatible("普通批", "普通"), true);
    assert.equal(admissionTypesCompatible("本科批", ""), true);
    assert.equal(admissionTypesCompatible("国家专项", "普通批"), false);
  });

  it("treats 艺术类 score rows as compatible with 普通批 art plans", () => {
    assert.equal(admissionTypesCompatible("艺术类", "普通批"), true);
    assert.equal(admissionTypesCompatible("艺术类", "国家专项"), false);
  });
});

describe("planMajorLateralSql", () => {
  it("embeds the plan year bind index", () => {
    const sql = planMajorLateralSql(8);
    assert.match(sql, /\$8::int/);
    assert.match(sql, /plan_major_line/);
    assert.match(sql, /plan_campus/);
    assert.match(sql, /COALESCE\(\$8::int, ss\.year\)/);
  });

  it("allows any plan campus when score campus is empty", () => {
    const sql = planMajorLateralSql(8);
    assert.match(sql, /COALESCE\(NULLIF\(ss\.campus, ''\), ''\) = ''/);
    assert.match(sql, /replace\(replace\(sml\.major_name, '与', ''\)/);
  });
});
