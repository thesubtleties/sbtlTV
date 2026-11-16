import './KnockWords.css';

/** The code (receiver) or the three words (both sides), large and easy to read out. */
export function KnockWords({ code, words }: { code?: string; words?: string[] }) {
  if (code) return <div className="knock-code" role="img" aria-label={`Code ${code.split('').join(' ')}`}>{code.slice(0, 4)}-{code.slice(4)}</div>;
  if (words) return <div className="knock-words">{words.join(' · ')}</div>;
  return null;
}
