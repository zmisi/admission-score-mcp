import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ADMISSION_YEAR,
  resolveAdmissionYear,
} from "./defaultAdmissionYear.js";

describe("resolveAdmissionYear", () => {
  it("defaults to 2025 when year is omitted", () => {
    assert.equal(resolveAdmissionYear(), DEFAULT_ADMISSION_YEAR);
    assert.equal(resolveAdmissionYear(undefined), 2025);
    assert.equal(DEFAULT_ADMISSION_YEAR, 2025);
  });

  it("keeps explicit year", () => {
    assert.equal(resolveAdmissionYear(2024), 2024);
  });
});
