// Live captions (EIA-608): telling real captions from station-data junk, and
// which language they are in. No electron imports, so it runs under node:test.

import type { CaptionLanguage } from './subtitle-settings.js';

/**
 * Is this live caption text real captions or the station data (XDS) that
 * ffmpeg's 608 decoder shows when its "auto" field choice locks onto field 2?
 * XDS comes out as the network or show name glued to stray bytes ("H@ABC
 * NetworkGMA 3H@", "HDDateline DaytimeHD") or short repeating pieces
 * ("HEHEHE", "CNNCNN", "HGTEHCHG"). Tuned on a 12-channel sample (2026-10-12).
 */
export function judgeCaptionText(text: string): 'ok' | 'junk' | 'unknown' {
  if (text.includes('@')) return 'junk';
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 6) return 'unknown';
  if (/\p{Ll}\p{Lu}{2}|\p{Lu}{3,}\p{Ll}/u.test(text)) return 'junk';  // case glued mid-word: "NetworkGMA", "HDDateline"
  for (const token of text.split(/\s+/)) {
    const word = token.replace(/[^\p{L}]/gu, '');
    if (word.length < 6) continue;
    if (isRepeatedUnit(word)) return 'junk';
    if (word === word.toUpperCase() && hasRepeatedBigram(word) && vowelRatio(word) < 0.25) return 'junk';
  }
  // Real captions are words with spaces. One glued run of letters ("CNNCPA",
  // the start of "CNNCPASNNCNN") proves nothing, unless it is a finished word ("COVERED?").
  const words = text.split(/\s+/).filter((t) => /\p{L}/u.test(t));
  if (words.length < 2 && !/\p{L}{4,}[.?!,]$/u.test(text.trim())) return 'unknown';
  return 'ok';
}

function isRepeatedUnit(word: string): boolean {
  // Short pieces ("HEHEHE", "CNNCNN"), or a station name looping
  // ("9NEWSKUSA9NEWSKUSA9NEWS") at least two and a half times over.
  for (let unit = 1; unit <= 12; unit++) {
    if (unit > 3 && word.length < unit * 2.5) break;
    const piece = word.slice(0, unit);
    if (piece.repeat(Math.ceil(word.length / unit)).startsWith(word)) return true;
  }
  return false;
}

function hasRepeatedBigram(word: string): boolean {
  const seen = new Set<string>();
  for (let i = 0; i + 2 <= word.length; i++) {
    const pair = word.slice(i, i + 2);
    if (seen.has(pair)) return true;
    seen.add(pair);
  }
  return false;
}

function vowelRatio(word: string): number {
  return (word.match(/[AEIOUYaeiouy]/g)?.length ?? 0) / word.length;
}

// Words that mark English, Spanish or French captions (US/Canadian broadcast
// captions are one of the three). Words the languages share ("de", "la", "que",
// "en", "un", "no") count for both; accents and ñ ¿ ¡ tip the balance.
const LANGUAGE_WORDS: Record<CaptionLanguage, Set<string>> = {
  en: new Set(['the', 'and', 'you', 'to', 'of', 'is', 'that', 'it', 'in', 'for', 'this', 'what', 'we', 'have', 'i', "i'm", "i'll", "don't", "it's", "that's", "you're", 'my', 'with', 'be', 'are', 'was', 'not', 'but', 'on', 'your', 'from', 'his', 'her', 'they', 'all', 'just', 'if', 'about', 'there', 'he', 'she', 'can', 'will', 'so', 'do', 'at', 'an', 'or']),
  es: new Set(['que', 'de', 'el', 'la', 'los', 'las', 'y', 'en', 'es', 'por', 'con', 'para', 'una', 'un', 'lo', 'se', 'del', 'está', 'esta', 'pero', 'más', 'su', 'al', 'como', 'mi', 'te', 'tu', 'estoy', 'son', 'ya', 'nada', 'tienen', 'hora', 'muy', 'sí', 'qué', 'yo', 'eso', 'este', 'hay']),
  fr: new Set(['le', 'la', 'les', 'de', 'des', 'et', 'est', 'que', 'qui', 'pas', 'pour', 'une', 'un', 'dans', 'je', 'vous', 'nous', 'ce', 'il', 'elle', 'avec', 'sur', 'au', 'en', 'du', 'ne', 'tout', 'alors', 'vos', 'contre', "qu'est", "c'est", 'mais', 'sont', 'oui', 'aux', 'cette', 'votre', 'très', 'fait']),
};

/** English, Spanish or French, from a few caption lines; unknown when the words do not say. */
export function detectCaptionLanguage(text: string): CaptionLanguage | 'unknown' {
  const lower = text.toLowerCase().replace(/[’‘]/g, "'");
  const words = lower.split(/[^\p{L}']+/u).filter(Boolean);
  const score: Record<CaptionLanguage, number> = { en: 0, es: 0, fr: 0 };
  for (const word of words) {
    for (const lang of ['en', 'es', 'fr'] as const) if (LANGUAGE_WORDS[lang].has(word)) score[lang]++;
  }
  score.es += 3 * (lower.match(/[ñ¿¡]/g)?.length ?? 0) + (lower.match(/[áíóú]/g)?.length ?? 0);
  score.fr += 2 * (lower.match(/[èàùâêîôûçœ]/g)?.length ?? 0);
  const ranked = (Object.entries(score) as Array<[CaptionLanguage, number]>).sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = ranked;
  return top >= 3 && top >= 2 * second ? best : 'unknown';
}

/** A fragment of station data can look like a word for a moment; this many different real lines confirm. */
const CONFIRM_LINES = 3;
/** With a language wanted, short lines that do not say which language they are in are read on up to this many. */
const LANGUAGE_LINES = 8;

/**
 * Live captions are checked in their first lines: real text ends the check,
 * station-data junk asks for a decoder restart (a fresh "auto" field choice,
 * about a coin flip on most channels), and after maxRetries the captions are
 * declared unreadable. Never second-guesses captions once they looked real.
 */
export class CaptionCheck {
  state: 'checking' | 'ok' | 'other-language' | 'unreadable' = 'checking';
  retries = 0;
  /** The language shown when only another one ever came through */
  language: CaptionLanguage | null = null;
  private otherLanguageSeen: CaptionLanguage | null = null;
  private acceptAny = false;
  private ignore: string | null = null;
  private lastText: string | null = null;
  private realLines: string[] = [];  // different real-looking lines in a row since the decoder (re)started

  /** preferred: the caption language wanted (null: any); the other field's language is flipped away from */
  constructor(private readonly maxRetries = 8, private readonly preferred: CaptionLanguage | null = null) {}

  observe(text: string): 'none' | 'ok' | 'other-language' | 'retry' | 'unreadable' {
    if (this.state !== 'checking') return 'none';
    if (this.ignore !== null) {
      if (text === this.ignore) return 'none';  // the junk lingering until the restarted decoder clears it
      this.ignore = null;
    }
    if (text === this.lastText) return 'none';  // read every few hundred ms; only changes count
    this.lastText = text;
    const verdict = judgeCaptionText(text);
    if (verdict === 'ok') {
      this.realLines.push(text);
      if (this.realLines.length < CONFIRM_LINES) return 'none';
      if (!this.preferred) {
        this.state = 'ok';
        return 'ok';
      }
      const language = detectCaptionLanguage(this.realLines.join(' / '));
      if (language === 'unknown' && this.realLines.length < LANGUAGE_LINES) return 'none';
      if (language === 'unknown' || language === this.preferred) {
        this.state = 'ok';
        return 'ok';
      }
      // Real captions, other language: the other caption field. Flip for the wanted one;
      // if the budget runs out, show these rather than nothing.
      this.otherLanguageSeen = language;
      if (this.acceptAny || this.retries >= this.maxRetries) {
        this.state = 'other-language';
        this.language = language;
        return 'other-language';
      }
      return this.restart(text);
    }
    if (verdict !== 'junk') return 'none';
    if (this.retries >= this.maxRetries) {
      if (this.otherLanguageSeen && !this.acceptAny) {
        // Only junk and the other language so far: go back for the other language.
        this.acceptAny = true;
        this.retries = 0;
        return this.restart(text);
      }
      this.state = 'unreadable';
      return 'unreadable';
    }
    return this.restart(text);
  }

  private restart(text: string): 'retry' {
    this.realLines = [];
    this.retries++;
    this.ignore = text;
    return 'retry';
  }
}
