// Timelapse clips — the printer's timelapse root, zipped back together.
//
// Moonraker's timelapse plugin writes <name>.mp4 alongside a <name>.jpg poster
// frame in the same root, so a flat file list has to be paired up before it can
// be rendered. Extracted from the old TimelapseView so the panel deals only in
// presentation, matching useFileLibrary and usePrintHistory.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fileUrl, type FileEntry } from '../services/moonraker';

const VIDEO = /\.(mp4|mkv|webm)$/i;
const POSTER = /\.jpe?g$/i;

export interface TimelapseClip {
  /** Path within the timelapse root, e.g. "dragon_2026-07-28.mp4". */
  path: string;
  /** Leaf name without the extension. */
  name: string;
  size: number;
  modified: number;
  videoUrl: string;
  /** null when the plugin never wrote a poster frame for this clip. */
  posterUrl: string | null;
}

export interface TimelapseLibrary {
  clips: TimelapseClip[];
  loading: boolean;
  error: string;
  /** Combined size of every clip — timelapses are the biggest thing on the SD card. */
  totalBytes: number;
  refresh: () => void;
}

function stem(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.\w+$/, '');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function useTimelapses(base: string, connected: boolean): TimelapseLibrary {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    if (!base) return;
    setLoading(true);
    api
      .listFilesRoot(base, 'timelapse')
      .then((list) => {
        setFiles(Array.isArray(list) ? list : []);
        setError('');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [base]);

  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  const clips = useMemo<TimelapseClip[]>(() => {
    const posters = new Set(files.filter((f) => POSTER.test(f.path)).map((f) => f.path));
    return files
      .filter((f) => VIDEO.test(f.path))
      .sort((a, b) => b.modified - a.modified)
      .map((video) => {
        const poster = video.path.replace(/\.\w+$/, '.jpg');
        return {
          path: video.path,
          name: stem(video.path),
          size: video.size,
          modified: video.modified,
          videoUrl: fileUrl(base, 'timelapse', video.path),
          posterUrl: posters.has(poster) ? fileUrl(base, 'timelapse', poster) : null,
        };
      });
  }, [base, files]);

  const totalBytes = useMemo(() => clips.reduce((sum, c) => sum + c.size, 0), [clips]);

  return { clips, loading, error, totalBytes, refresh };
}
