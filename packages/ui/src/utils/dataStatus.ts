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
