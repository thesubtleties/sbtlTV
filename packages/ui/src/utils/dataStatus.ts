export type DataStatus = 'fatal' | 'reset';

/** The startup check and the live event can both report the same thing: tell the user once. */
export function onceEachStatus(notify: (status: DataStatus) => void): (status: DataStatus | null) => void {
  const told = new Set<DataStatus>();
  return (status) => {
    if (!status || told.has(status)) return;
    told.add(status);
    notify(status);
  };
}

export interface DataStatusSource {
  status(): Promise<DataStatus | null>;
  onStatus(callback: (status: DataStatus) => void): () => void;
}

/** Both ways a status arrives, told once each. Returns the unsubscribe. */
export function watchDataStatus(source: DataStatusSource | undefined, notify: (status: DataStatus) => void): (() => void) | undefined {
  if (!source) return undefined;
  const show = onceEachStatus(notify);
  const check = () => source.status().then(show, () => { /* the live event still arrives */ });
  void check();
  // Reading it marks it delivered, so a window opened later doesn't hear it again
  return source.onStatus((status) => { show(status); void check(); });
}
