import { useEffect, useRef, useState } from 'react';
import type { DataRequestBody, DataTable, ReplyForBody } from '@sbtltv/core';
import { data } from './client';

// Runs a query, re-runs it when any of `tables` changes, and keeps the previous
// result while a new one is in flight (no flash to empty). `req` null = idle.
// `deps` must change whenever `req` changes.
export function useDataQuery<B extends DataRequestBody>(req: B | null, tables: DataTable[], deps: unknown[]): { data: ReplyForBody<B> | undefined; loading: boolean } {
  const [result, setResult] = useState<ReplyForBody<B> | undefined>(undefined);
  const [loading, setLoading] = useState(req !== null);
  const reqRef = useRef(req);
  reqRef.current = req;
  const key = JSON.stringify(deps);
  const tablesKey = tables.join(',');

  useEffect(() => {
    let alive = true;
    let generation = 0;
    const run = async () => {
      const r = reqRef.current;
      if (!r) { setResult(undefined); setLoading(false); return; }
      const mine = ++generation;
      setLoading(true);
      try {
        const out = await data.query(r);
        if (alive && mine === generation) { setResult(out); setLoading(false); }
      } catch {
        if (alive && mine === generation) setLoading(false);
      }
    };
    void run();
    const unsubscribe = data.subscribe(tablesKey ? (tablesKey.split(',') as DataTable[]) : [], () => { void run(); });
    return () => { alive = false; unsubscribe(); };
  }, [key, tablesKey]);

  return { data: result, loading };
}
