// Print history — paged job list plus lifetime totals.
//
// Extracted from components/HistoryView.tsx so the redesigned panel and the
// existing one can share the fetching, and so the derived numbers the old view
// never showed (success rate, per-day grouping) live in one place.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type HistoryJob, type HistoryTotals } from '../services/moonraker';
import { t } from '../services/i18n';

const PAGE = 30;

export type JobOutcome = 'success' | 'failed' | 'running' | 'unknown';

export function outcomeOf(status: string): JobOutcome {
  switch (status) {
    case 'completed':
      return 'success';
    case 'cancelled':
    case 'error':
    case 'klippy_shutdown':
    case 'klippy_disconnect':
    case 'interrupted':
    // Moonraker restarted mid-print. The print didn't finish, so it belongs
    // with the failures — leaving it 'unknown' silently excluded these jobs
    // from the success rate and made the denominator wrong.
    case 'server_exit':
      return 'failed';
    case 'in_progress':
      return 'running';
    default:
      return 'unknown';
  }
}

/** Human label for the raw Moonraker status. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return t('Completed');
    case 'cancelled':
      return t('Cancelled');
    case 'error':
      return t('Failed');
    case 'klippy_shutdown':
      return t('Firmware shutdown');
    case 'klippy_disconnect':
      return t('Disconnected');
    case 'interrupted':
      return t('Interrupted');
    case 'server_exit':
      return t('Server restarted');
    case 'in_progress':
      return t('Running');
    default:
      // Unknown statuses are rendered readably rather than as raw snake_case.
      return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
}

/** Day bucket used to group the list: "Today", "Yesterday", then a date. */
export function dayLabel(epoch: number): string {
  const d = new Date(epoch * 1000);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days <= 0) return t('Today');
  if (days === 1) return t('Yesterday');
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'long', day: 'numeric' });
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m` : `${s}s`;
}

/** Moonraker reports filament in mm of 1.75mm stock. */
export function fmtFilament(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return '--';
  return mm >= 1000 ? `${(mm / 1000).toFixed(1)} m` : `${Math.round(mm)} mm`;
}

export interface HistoryDay {
  label: string;
  jobs: HistoryJob[];
}

export interface PrintHistory {
  jobs: HistoryJob[];
  /** Jobs bucketed by day, newest first — history is read chronologically. */
  days: HistoryDay[];
  totals: HistoryTotals | null;
  loading: boolean;
  error: string;
  /** Completed / (completed + failed) over the loaded page, 0..1, null if none. */
  successRate: number | null;
  successes: number;
  failures: number;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
}

export function usePrintHistory(base: string, connected: boolean): PrintHistory {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [totals, setTotals] = useState<HistoryTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Set when a page comes back short, which is the only trustworthy end signal
  // this API gives (see the cursor comment below).
  const [exhausted, setExhausted] = useState(false);

  // Scrolling fires onEndReached repeatedly while a page is still in flight;
  // without this guard each one would re-request the same offset and append
  // the jobs twice, corrupting both the list keys and the success rate.
  const inFlight = useRef(false);

  // Paging cursor, tracked separately from jobs.length because dedupe can drop
  // rows — advancing by what we kept rather than by what we fetched would
  // re-request the same offset forever.
  const nextStart = useRef(0);

  const load = useCallback(
    async (start: number, replace: boolean) => {
      if (!base || inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      setError('');
      try {
        const [list, tot] = await Promise.all([
          api.historyList(base, PAGE, start),
          start === 0 ? api.historyTotals(base) : Promise.resolve(null),
        ]);
        // list.count is the size of THIS page, not the history depth — asking
        // for 30 always answers 30. Trusting it stopped paging after one page.
        // A short page is the end; /server/history/totals can't stand in for it
        // either, since total_jobs is a lifetime counter that keeps climbing
        // after old rows are pruned (174 lifetime vs 129 rows on this printer).
        const received = list.jobs.length;
        nextStart.current = start + received;
        setExhausted(received < PAGE);
        setJobs((prev) => {
          if (replace) return list.jobs;
          // Moonraker can shift a job between pages when one finishes mid-scroll,
          // so drop anything already held rather than trusting the offset.
          const seen = new Set(prev.map((job) => job.job_id));
          return [...prev, ...list.jobs.filter((job) => !seen.has(job.job_id))];
        });
        if (tot) setTotals(tot.job_totals);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [base]
  );

  useEffect(() => {
    if (connected) void load(0, true);
  }, [connected, load]);

  const days = useMemo<HistoryDay[]>(() => {
    const out: HistoryDay[] = [];
    for (const job of jobs) {
      const label = dayLabel(job.start_time);
      const last = out[out.length - 1];
      if (last && last.label === label) last.jobs.push(job);
      else out.push({ label, jobs: [job] });
    }
    return out;
  }, [jobs]);

  const { successes, failures } = useMemo(() => {
    let s = 0;
    let f = 0;
    for (const job of jobs) {
      const o = outcomeOf(job.status);
      if (o === 'success') s += 1;
      else if (o === 'failed') f += 1;
    }
    return { successes: s, failures: f };
  }, [jobs]);

  const refresh = useCallback(() => {
    nextStart.current = 0;
    setExhausted(false);
    void load(0, true);
  }, [load]);

  const loadMore = useCallback(() => {
    if (exhausted) return;
    void load(nextStart.current, false);
  }, [exhausted, load]);

  return {
    jobs,
    days,
    totals,
    loading,
    error,
    successes,
    failures,
    successRate: successes + failures > 0 ? successes / (successes + failures) : null,
    refresh,
    loadMore,
    hasMore: !exhausted,
  };
}
