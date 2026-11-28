import { Paths } from 'expo-file-system';
import { openRnDb } from '../platform/db';
import { assertEq, type SelfTestSuite } from './runner';

const fresh = () => {
  const p = `${Paths.cache.uri.replace(/^file:\/\//, '')}/selftest-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  return openRnDb(p, { readOnly: false, busyTimeoutMs: 5000 });
};

export const dbSuite: SelfTestSuite = { name: 'db', tests: [
  { name: 'named and positional params', run: () => {
    const db = fresh(); db.exec('create table t(a text, b integer)');
    db.prepare('insert into t values (?, ?)').run('x', 1);
    db.prepare('insert into t values ($a, $b)').run({ $a: 'y', $b: 2 });
    assertEq(db.prepare('select a, b from t order by b').all(), [{ a: 'x', b: 1 }, { a: 'y', b: 2 }], 'rows');
    assertEq(db.prepare('select a from t where b = $b').get({ $b: 2 }), { a: 'y' }, 'named get'); db.close();
  } },
  { name: 'missing row is undefined', run: () => {
    const db = fresh(); db.exec('create table t(a)');
    assertEq(db.prepare('select a from t').get() === undefined, true, 'undefined'); db.close();
  } },
  { name: 'run reports changes; a statement is reusable', run: () => {
    const db = fresh(); db.exec('create table t(a)'); const ins = db.prepare('insert into t values (?)');
    for (let i = 0; i < 3; i++) ins.run(i);
    assertEq(Number(db.prepare('delete from t where a < 2').run().changes), 2, 'changes'); db.close();
  } },
  { name: 'transactions commit and roll back', run: () => {
    const db = fresh(); db.exec('create table t(a)');
    db.exec('begin immediate'); db.prepare('insert into t values (1)').run(); db.exec('rollback');
    db.exec('begin'); db.prepare('insert into t values (2)').run(); db.exec('commit');
    assertEq(db.prepare('select a from t').all(), [{ a: 2 }], 'rows'); db.close();
  } },
  { name: 'FTS5, JSON1 and temp_store = file', run: () => {
    const db = fresh();
    db.exec("create virtual table f using fts5(x); insert into f values ('hello world')");
    assertEq(db.prepare("select count(*) c from f where f match 'hello'").get(), { c: 1 }, 'fts5');
    assertEq(db.prepare("select json_array_length('[1,2]') n").get(), { n: 2 }, 'json1');
    assertEq(db.prepare('pragma temp_store').get(), { temp_store: 1 }, 'temp_store'); db.close();
  } },
  { name: 'ATTACH of a scratch file', run: () => {
    const db = fresh(); const scratch = `${Paths.cache.uri.replace(/^file:\/\//, '')}/selftest-attach-${Date.now()}.sqlite`;
    db.prepare('attach database ? as s1').run(scratch);
    db.exec('create table s1.x(a); insert into s1.x values (7)');
    assertEq(db.prepare('select a from s1.x').get(), { a: 7 }, 'attached'); db.exec('detach database s1'); db.close();
  } },
  { name: 'URL is WHATWG (the LAN guard needs normalised hosts)', run: () => {
    assertEq(['http://0x7f000001/', 'http://2130706433/', 'http://[::1]/', 'http://192.168.000.001/'].map((u) => new URL(u).hostname), ['127.0.0.1', '127.0.0.1', '[::1]', '192.168.0.1'], 'hosts');
  } },
  { name: 'a reader and a writer on one file are separate connections', run: () => {
    const p = `${Paths.cache.uri.replace(/^file:\/\//, '')}/selftest-rw-${Date.now()}.sqlite`;
    const w = openRnDb(p, { readOnly: false, busyTimeoutMs: 5000 }); w.exec('create table t(a)');
    const r = openRnDb(p, { readOnly: true, busyTimeoutMs: 5000 });
    w.prepare('insert into t values (1)').run();
    assertEq(r.prepare('select count(*) c from t').get(), { c: 1 }, 'reader sees the write'); r.close(); w.close();
  } },
] };
