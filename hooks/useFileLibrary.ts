// Gcode library — the file list plus the per-file metadata the current Files
// screen only fetches for thumbnails.
//
// Moonraker's /server/files/list gives path, size and mtime only; print time,
// filament weight and the preview all need a per-file /server/files/metadata
// call. The existing screen does that inline just for the thumbnail, so the
// list can't show anything useful without opening a file. This hook fetches it
// once per file and caches it, which is what lets a card show duration and
// weight up front.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMoonraker } from './useMoonraker';
import { api, thumbnailUrl, type FileEntry } from '../services/moonraker';
import { t } from '../services/i18n';

export interface LibraryFile {
  /** Full path as Moonraker reports it, e.g. "subdir/dragon.gcode". */
  path: string;
  /** Leaf name without the .gcode extension. */
  name: string;
  /** Containing folder, '' for the root. */
  folder: string;
  size: number;
  modified: number;
  /** undefined = metadata not fetched yet, null = fetched and absent. */
  thumbUri?: string | null;
  estSeconds?: number | null;
}

export type SortKey = 'recent' | 'name' | 'size' | 'duration';

// path|modified -> enrichment. Module-level so remounting the screen (or
// switching design directions) doesn't re-hit metadata for every row.
const metaCache = new Map<string, Pick<LibraryFile, 'thumbUri' | 'estSeconds'>>();

function stem(path: string): string {
  const leaf = path.split('/').pop() ?? path;
  return leaf.replace(/\.gcode$/i, '');
}

function folderOf(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "Today", "Yesterday", "3d ago", then a date. Relative reads faster in a list. */
export function formatWhen(epoch: number): string {
  const then = new Date(epoch * 1000);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return t('Yesterday');
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export interface FileLibrary {
  files: LibraryFile[];
  loading: boolean;
  error: string;
  connected: boolean;
  refresh: () => void;
  query: string;
  setQuery: (q: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
}

export function useFileLibrary(): FileLibrary {
  const { activeUrl, connection } = useMoonraker();
  const connected = connection === 'connected';

  const [raw, setRaw] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  // Bumped when a metadata fetch resolves, to re-read the cache.
  const [metaTick, setMetaTick] = useState(0);

  const refresh = useCallback(() => {
    if (!activeUrl) return;
    setLoading(true);
    api
      .listFiles(activeUrl)
      .then((list) => {
        setRaw(Array.isArray(list) ? list : []);
        setError('');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [activeUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Enrich in the background, oldest-listed first, one at a time so a large
  // library doesn't fire hundreds of parallel requests at the printer.
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  useEffect(() => {
    if (!activeUrl) return;
    queueRef.current = raw
      .filter((f) => !metaCache.has(`${f.path}|${f.modified}`))
      .map((f) => `${f.path}|${f.modified}`);

    let alive = true;
    const pump = async () => {
      if (busyRef.current || queueRef.current.length === 0) return;
      busyRef.current = true;
      while (alive && queueRef.current.length > 0) {
        const key = queueRef.current.shift() as string;
        const path = key.slice(0, key.lastIndexOf('|'));
        try {
          const meta: any = await api.metadata(activeUrl, path);
          const thumbs: any[] = Array.isArray(meta?.thumbnails) ? meta.thumbnails : [];
          const best = thumbs.reduce(
            (a, b) => (!a || (b?.width ?? 0) > (a?.width ?? 0) ? b : a),
            null as any
          );
          metaCache.set(key, {
            thumbUri: best?.relative_path ? thumbnailUrl(activeUrl, path, best.relative_path) : null,
            estSeconds: typeof meta?.estimated_time === 'number' ? meta.estimated_time : null,
          });
        } catch {
          metaCache.set(key, { thumbUri: null, estSeconds: null });
        }
        if (alive) setMetaTick((n) => n + 1);
      }
      busyRef.current = false;
    };
    void pump();
    return () => {
      alive = false;
    };
  }, [activeUrl, raw]);

  const files = useMemo(() => {
    void metaTick; // re-read metaCache when an enrichment lands
    const mapped: LibraryFile[] = raw.map((f) => {
      const meta = metaCache.get(`${f.path}|${f.modified}`);
      return {
        path: f.path,
        name: stem(f.path),
        folder: folderOf(f.path),
        size: f.size,
        modified: f.modified,
        ...meta,
      };
    });

    const q = query.trim().toLowerCase();
    const filtered = q ? mapped.filter((f) => f.path.toLowerCase().includes(q)) : mapped;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'size':
          return b.size - a.size;
        case 'duration':
          return (b.estSeconds ?? 0) - (a.estSeconds ?? 0);
        default:
          return b.modified - a.modified;
      }
    });
    return sorted;
  }, [metaTick, query, raw, sort]);

  return {
    files,
    loading,
    error,
    connected,
    refresh,
    query,
    setQuery,
    sort,
    setSort,
  };
}
