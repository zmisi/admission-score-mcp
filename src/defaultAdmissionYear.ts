/** Default Gaokao admission year when callers omit {@code year}. */
export const DEFAULT_ADMISSION_YEAR = 2025;

export function resolveAdmissionYear(year?: number): number {
  return year ?? DEFAULT_ADMISSION_YEAR;
}
