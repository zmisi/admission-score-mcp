const SCHEMA = "admissions";

/** PostgreSQL bind index for optional query year used in plan_snapshot.year lookup. */
export const PLAN_YEAR_PARAM_BY_SCORE = 8;
export const PLAN_YEAR_PARAM_BY_RANK = 9;

const GENERAL_ADMISSION_TYPES = ["普通批", "普通", "本科批", ""];

/** Main-campus labels stored in plan snapshots (also normalized to "" on import). */
export const MAIN_CAMPUS_ALIASES = ["校本部", "淮南校区", "不分校区"];

/**
 * SQL fragment: LEFT JOIN LATERAL to plan_snapshot + plan_major_line for plan_count and campus.
 * Plan year: COALESCE($planYearParam, ss.year) — query year when provided, else score row year.
 */
export function planMajorLateralSql(planYearParamIndex: number): string {
  return `
LEFT JOIN LATERAL (
  SELECT
    pml.plan_count,
    CASE
      WHEN COALESCE(NULLIF(ps.campus, ''), '') = '' THEN '校本部'
      ELSE ps.campus
    END AS plan_campus
  FROM ${SCHEMA}.plan_snapshot ps
  JOIN ${SCHEMA}.plan_major_line pml ON pml.snapshot_id = ps.id
  WHERE ps.university_code = ss.university_code
    AND ps.province = ss.province
    AND ps.year = COALESCE($${planYearParamIndex}::int, ss.year)
    AND (
      COALESCE(NULLIF(ps.campus, ''), '') = COALESCE(NULLIF(ss.campus, ''), '')
      OR COALESCE(NULLIF(ss.campus, ''), '') = ''
      OR (
        COALESCE(NULLIF(ss.campus, ''), '') IN (${MAIN_CAMPUS_ALIASES.map((c) => `'${c}'`).join(", ")})
        AND COALESCE(NULLIF(ps.campus, ''), '') IN ('', ${MAIN_CAMPUS_ALIASES.map((c) => `'${c}'`).join(", ")})
      )
    )
    AND (
      COALESCE(NULLIF(ps.admission_type, ''), '') = COALESCE(NULLIF(ss.admission_type, ''), '')
      OR (
        COALESCE(NULLIF(ss.admission_type, ''), '') IN ('普通批', '普通', '本科批', '')
        AND COALESCE(NULLIF(ps.admission_type, ''), '') IN ('普通批', '普通', '本科批', '')
      )
      OR (
        COALESCE(NULLIF(ss.admission_type, ''), '') = '艺术类'
        AND COALESCE(NULLIF(ps.admission_type, ''), '') IN ('艺术类', '普通批', '普通')
        AND (
          ss.subject_group LIKE '%艺术%'
          OR ps.subject_group LIKE '%艺术%'
        )
      )
    )
    AND (
      ps.subject_group = ss.subject_group
      OR ps.subject_group LIKE left(ss.subject_group, 2) || '%'
      OR ss.subject_group LIKE left(ps.subject_group, 2) || '%'
      OR (left(ss.subject_group, 2) = '物理' AND ps.subject_group = '理工类')
      OR (left(ps.subject_group, 2) = '物理' AND ss.subject_group = '理工类')
      OR (left(ss.subject_group, 2) = '历史' AND ps.subject_group = '文史类')
      OR (left(ps.subject_group, 2) = '历史' AND ss.subject_group = '文史类')
    )
    AND (
      pml.major_name = sml.major_name
      OR sml.major_name LIKE pml.major_name || '(%'
      OR (
        length(pml.major_name) >= 4
        AND sml.major_name LIKE '%' || pml.major_name || '%'
      )
      OR replace(replace(sml.major_name, '与', ''), '及', '') =
         replace(replace(pml.major_name, '与', ''), '及', '')
    )
  ORDER BY
    CASE
      WHEN pml.major_name = sml.major_name THEN 0
      WHEN sml.major_name LIKE pml.major_name || '(%' THEN 1
      WHEN replace(replace(sml.major_name, '与', ''), '及', '') =
           replace(replace(pml.major_name, '与', ''), '及', '') THEN 2
      ELSE 3
    END,
    CASE
      WHEN COALESCE(NULLIF(ps.campus, ''), '') = COALESCE(NULLIF(ss.campus, ''), '') THEN 0
      WHEN COALESCE(NULLIF(ps.campus, ''), '') IN ('', ${MAIN_CAMPUS_ALIASES.map((c) => `'${c}'`).join(", ")}) THEN 1
      ELSE 2
    END,
    length(pml.major_name) DESC
  LIMIT 1
) plan ON true`;
}

/** Exported for tests. Lower is a better major-name match. */
export function majorNameMatchRank(
  scoreMajorName: string,
  planMajorName: string,
): number | null {
  if (scoreMajorName === planMajorName) {
    return 0;
  }
  if (scoreMajorName.startsWith(planMajorName + "(")) {
    return 1;
  }
  if (
    scoreMajorName.replace(/[与及]/g, "") ===
    planMajorName.replace(/[与及]/g, "")
  ) {
    return 2;
  }
  if (planMajorName.length >= 4 && scoreMajorName.includes(planMajorName)) {
    return 3;
  }
  return null;
}

/** Exported for tests. True when score and plan admission_type can match. */
export function admissionTypesCompatible(
  scoreType: string | null | undefined,
  planType: string | null | undefined,
): boolean {
  const score = normalizeAdmissionType(scoreType);
  const plan = normalizeAdmissionType(planType);
  if (score === plan) {
    return true;
  }
  if (
    GENERAL_ADMISSION_TYPES.includes(score) &&
    GENERAL_ADMISSION_TYPES.includes(plan)
  ) {
    return true;
  }
  if (
    score === "艺术类" &&
    (plan === "艺术类" || plan === "普通批" || plan === "普通")
  ) {
    return true;
  }
  return false;
}

function normalizeAdmissionType(value: string | null | undefined): string {
  if (value == null || value.trim() === "") {
    return "";
  }
  return value.trim();
}
