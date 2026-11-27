import { expect, test } from 'vitest';
import { redact, setRedactor } from '../src/redact.js';

test('redact() without a redactor throws instead of passing text through', () => {
  setRedactor(null);
  expect(() => redact('http://h/get.php?username=bob&password=s3cret')).toThrow('no redactor set');
});

test('redact() uses the redactor that was set', () => {
  setRedactor((t) => t.replace('s3cret', '•'));
  expect(redact('password=s3cret')).toBe('password=•');
});
