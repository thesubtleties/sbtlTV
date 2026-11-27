import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { titleMatcher } from '../src/tmdb-match.js';

function db(rows: [string, number, number | null, number][]) {
  const d = new DatabaseSync(':memory:');
  d.exec('create table movie_titles(norm text not null, id integer not null, year integer, popularity real not null); create index movie_titles_norm on movie_titles(norm)');
  const ins = d.prepare('insert into movie_titles values (?, ?, ?, ?)');
  for (const r of rows) ins.run(...r);
  return d;
}

test('a year hit wins, the first in file order among several', () => {
  const m = titleMatcher(db([['heat', 1, 1986, 99], ['heat', 2, 1995, 10], ['heat', 3, 1995, 50]]), 'movie');
  expect(m('Heat', 1995)).toEqual({ id: 2, popularity: 10 });
});

test('no year, or no hit for the year: the most popular; equal popularity -> the earlier line', () => {
  const m = titleMatcher(db([['heat', 9, 0, 1], ['heat', 1, 1986, 20], ['heat', 2, 1995, 50], ['heat', 3, 2001, 50]]), 'movie');
  expect(m('Heat')).toEqual({ id: 2, popularity: 50 });
  expect(m('Heat', 1970)).toEqual({ id: 2, popularity: 50 });
  expect(m('Heat', 0)).toEqual({ id: 2, popularity: 50 }); // year 0 counts as no year, as before
});

test('a leading "the" is retried without it, only when the full title has no hit', () => {
  const m = titleMatcher(db([['matrix', 5, 1999, 1], ['the thing', 6, 1982, 1], ['thing', 7, 2011, 9]]), 'movie');
  expect(m('The Matrix')).toEqual({ id: 5, popularity: 1 });
  expect(m('The Thing')).toEqual({ id: 6, popularity: 1 });
});

test('titles that normalise to nothing, and unknown titles, match nothing', () => {
  const m = titleMatcher(db([['heat', 1, 1995, 1]]), 'movie');
  expect(m('!!!')).toBeNull();
  expect(m('Nope')).toBeNull();
});

test('the "the" retry keeps the year', () => {
  const m = titleMatcher(db([['thing', 7, 2011, 9], ['thing', 8, 1982, 1]]), 'movie');
  expect(m('The Thing', 1982)).toEqual({ id: 8, popularity: 1 });
});
