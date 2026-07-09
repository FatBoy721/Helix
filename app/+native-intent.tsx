/**
 * Expo Router rewrites Android VIEW intents (content://…/file.3mf) into
 * u1control://… paths. Those are not real routes — send them to Slice and let
 * getSharedModelFile() import the file natively.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    const p = decodeURIComponent(path).toLowerCase();
    const looksLikeFileOpen =
      p.includes('/downloads/') ||
      p.includes('/external/') ||
      p.includes('/document/') ||
      p.endsWith('.3mf') ||
      p.endsWith('.stl') ||
      p.includes('.3mf?') ||
      p.includes('.stl?');

    if (looksLikeFileOpen) {
      return '/slicer';
    }
  } catch {
    // Keep the original path on parse errors.
  }
  return path;
}
