import { useEffect, useState } from 'react';
import { data } from '../data/client';
import { useUIStore } from '../stores/uiStore';

export type DataState = 'loading' | 'rebuilding' | 'ready' | 'failed';

/** Why the lists may be empty: an empty guide before the data is there says nothing about the user's channels. */
export function useDataState(): DataState {
  const [ready, setReady] = useState(false);
  useEffect(() => { void data.ready.then(() => setReady(true)); }, []);
  const problem = useUIStore((s) => s.dataProblem);
  if (problem === 'fatal') return 'failed';
  if (problem === 'reset') return 'rebuilding';
  return ready ? 'ready' : 'loading';
}
