// The real redactor, so tests that store errors check real redaction. log-redact lives in Electron (its main
// process can't load workspace packages at runtime); importing it by path here is test-only.
import { cleanErrorText } from '../../electron/src/log-redact.js';
import { setRedactor } from '../src/redact.js';
setRedactor(cleanErrorText);
