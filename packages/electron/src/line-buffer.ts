// Process output arrives in chunks that can end mid-line. Logging each chunk
// as it comes could split a link across two log lines, and redaction only
// sees whole links, so output is handed on one complete line at a time.

/** Cut off and hand on a line that has grown this long without a newline (a stuck or binary stream). */
const MAX_PENDING = 64 * 1024;

export interface LineBuffer {
  push(chunk: string): void;
  /** Hand on what is left (the process ended without a final newline). */
  flush(): void;
}

export function createLineBuffer(onLine: (line: string) => void): LineBuffer {
  let pending = '';
  const emit = (line: string) => {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.trim()) onLine(trimmed);
  };
  return {
    push(chunk) {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        emit(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
      if (pending.length > MAX_PENDING) {
        emit(pending);
        pending = '';
      }
    },
    flush() {
      if (pending) emit(pending);
      pending = '';
    },
  };
}
