/** Errors that reach the database or the page go through here. No redactor set = refuse (fail closed). */
let redactor: ((text: string) => string) | null = null;
export function setRedactor(fn: ((text: string) => string) | null): void { redactor = fn; }
export function redact(text: string): string {
  if (!redactor) throw new Error('no redactor set: call setRedactor() before storing errors');
  return redactor(text);
}
