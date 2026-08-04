export const INDEX_VERSION = 2;

export function isCurrentIndexVersion(version?: number): boolean {
  return version === INDEX_VERSION;
}
