import test from "node:test";
import assert from "node:assert/strict";
import { parseGetMajorHistoryArgs } from "./getMajorHistory.js";

test("parseGetMajorHistoryArgs defaults history years from base year", () => {
  const parsed = parseGetMajorHistoryArgs({
    province: "安徽",
    base_year: 2025,
    majors: [{ university_code: "AUST", major_name: "数字媒体技术" }],
  });
  assert.deepEqual(parsed.years, [2024, 2023, 2026]);
});

test("parseGetMajorHistoryArgs normalizes subject group", () => {
  const parsed = parseGetMajorHistoryArgs({
    province: "安徽",
    majors: [
      {
        university_code: "AUST",
        major_name: "数字媒体技术",
        subject_group: "物理类",
      },
    ],
  });
  assert.equal(parsed.majors[0]?.subject_group, "物理");
});
