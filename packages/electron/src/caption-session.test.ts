import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { CaptionSession, type CaptionSessionIo } from './caption-session.js';
import type { SubtitleTrack } from './subtitle-mpv.js';

const cc: SubtitleTrack = { id: 1, lang: null, title: null, codec: 'eia_608', isCc: true };
const eng: SubtitleTrack = { id: 2, lang: 'eng', title: null, codec: 'subrip', isCc: false };

function fakeIo(lines: string[] = []) {
  const io = {
    generation: 1,
    options: [] as Array<[string, string]>,
    tracks: [] as Array<{ generation: number; tracks: SubtitleTrack[]; duration: number }>,
    states: [] as string[],
    lines,
    reads: 0,
    logs: [] as string[],
  };
  const api: CaptionSessionIo = {
    setOptions: (options) => { io.options.push(...options); },
    readSubText: async () => { io.reads++; return io.lines.shift() ?? ''; },
    sendTracks: (update) => { io.tracks.push(update); },
    sendCcState: (update) => { io.states.push(update.state); },
    log: (message) => { io.logs.push(message); },
    preferredLanguage: () => null,
    currentGeneration: () => io.generation,
  };
  return { io, api };
}

const option = (io: { options: Array<[string, string]> }, name: string) => io.options.filter(([n]) => n === name).at(-1)?.[1];

// Advance the check's 400ms timer and let its read settle.
async function tick(times: number) {
  for (let i = 0; i < times; i++) {
    mock.timers.tick(400);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('caption session: a load starts with no subtitle, no offset and no tracks', () => {
  const { io, api } = fakeIo();
  const session = new CaptionSession(api);
  session.setTracks([cc]);
  io.generation = 2;
  session.beginLoad();
  assert.equal(option(io, 'sid'), 'no');
  assert.equal(option(io, 'sub-delay'), '0');
  assert.deepEqual(io.tracks.at(-1), { generation: 2, tracks: [], duration: 0 });
});

test('caption session: a movie subtitle track is shown at once', () => {
  const { io, api } = fakeIo();
  const session = new CaptionSession(api);
  session.setTracks([eng]);
  session.selectTrack(2, true);
  assert.equal(option(io, 'sid'), '2');
  assert.equal(option(io, 'sub-visibility'), 'yes');
  assert.deepEqual(io.states, []);
});

test('caption session: live captions stay hidden until three real lines confirm them', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const { io, api } = fakeIo(['Good evening, everyone.', 'Here is the news tonight.', 'Thanks for joining us.']);
    const session = new CaptionSession(api);
    session.setTracks([cc]);
    session.selectTrack(1, true);
    assert.equal(option(io, 'sub-visibility'), 'no');
    assert.deepEqual(io.states, ['checking']);
    await tick(3);
    assert.deepEqual(io.states, ['checking', 'ok']);
    assert.equal(option(io, 'sub-visibility'), 'yes');
    // Selecting the same track again for this load does not check it again.
    session.selectTrack(1, false);
    assert.deepEqual(io.states, ['checking', 'ok']);
    assert.equal(option(io, 'sub-visibility'), 'no');
  } finally {
    mock.timers.reset();
  }
});

test('caption session: a check still running when the next load starts is dropped', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const { io, api } = fakeIo(['Good evening, everyone.', 'Here is the news tonight.', 'Thanks for joining us.']);
    const session = new CaptionSession(api);
    session.setTracks([cc]);
    session.selectTrack(1, true);
    session.beginLoad();  // same generation: only beginLoad can stop it
    await tick(5);
    assert.equal(io.reads, 0);
    assert.deepEqual(io.states, ['checking']);
  } finally {
    mock.timers.reset();
  }
});

test('caption session: a language change re-checks the selected live track of this load only', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const { io, api } = fakeIo();
    const session = new CaptionSession(api);
    session.setTracks([cc]);
    session.selectTrack(1, true);
    session.recheckLanguage();
    assert.deepEqual(io.states, ['checking', 'checking']);
    io.generation = 2;
    session.recheckLanguage();
    assert.deepEqual(io.states, ['checking', 'checking']);
  } finally {
    mock.timers.reset();
  }
});

test('caption session: the wanted language is waited for 30s at most, then what comes through is shown', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const spanish = (n: number) => [`Debería estar triste ${n},`, `Debería estar triste ${n}, / pero no`, `Debería estar triste ${n}, / pero no lo estoy.`];
    const { io, api } = fakeIo([...spanish(1), ...Array<string>(80).fill(''), ...spanish(2)]);
    const session = new CaptionSession({ ...api, preferredLanguage: () => 'en' });
    session.setTracks([cc]);
    session.selectTrack(1, true);
    await tick(3 + 80 + 3);
    assert.deepEqual(io.states, ['checking', 'other-language']);
    assert.equal(option(io, 'sub-visibility'), 'yes');
  } finally {
    mock.timers.reset();
  }
});

test('caption session: station data restarts the decoder, and after 8 restarts the captions stay off for this load', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const junk = Array.from({ length: 9 }, (_, i) => `H@ABC NetworkGMA ${i}H@`);
    const { io, api } = fakeIo(junk);
    const session = new CaptionSession(api);
    session.setTracks([cc]);
    session.selectTrack(1, true);
    await tick(1);
    assert.deepEqual(io.options.slice(-2), [['sid', 'no'], ['sid', '1']]);   // restarted, still hidden
    assert.equal(option(io, 'sub-visibility'), 'no');
    await tick(8);
    assert.deepEqual(io.states, ['checking', 'unreadable']);
    assert.equal(option(io, 'sid'), 'no');
    const before = io.options.length;
    session.selectTrack(1, true);   // the same track again: the junk is not brought back
    assert.equal(io.options.length, before);
  } finally {
    mock.timers.reset();
  }
});

test('caption session: turning captions off while they are checked keeps them off when they confirm', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const { io, api } = fakeIo(['Good evening, everyone.', 'Here is the news tonight.', 'Thanks for joining us.']);
    const session = new CaptionSession(api);
    session.setTracks([cc]);
    session.selectTrack(1, true);
    session.setVisible(false);
    assert.equal(option(io, 'sub-visibility'), 'no');
    session.setVisible(true);       // on again, still checking: stays hidden for now
    session.setVisible(false);
    await tick(3);
    assert.deepEqual(io.states, ['checking', 'ok']);
    assert.equal(option(io, 'sub-visibility'), 'no');
  } finally {
    mock.timers.reset();
  }
});

test('caption session: after playback ends, a late track choice does nothing', () => {
  const { io, api } = fakeIo();
  const session = new CaptionSession(api);
  session.setTracks([cc]);
  session.end();
  session.selectTrack(1, true);
  assert.deepEqual(io.states, []);
  assert.equal(option(io, 'sid'), 'no');
});

test('caption session: a failed caption read is logged and the check carries on', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const { io, api } = fakeIo(['Good evening, everyone.', 'Here is the news tonight.', 'Thanks for joining us.']);
    let failed = false;
    const session = new CaptionSession({ ...api, readSubText: async () => { if (!failed) { failed = true; throw new Error('mpv gone'); } return api.readSubText(); } });
    session.setTracks([cc]);
    session.selectTrack(1, true);
    await tick(4);
    assert.ok(io.logs.some((l) => l.includes('reading the caption line failed: mpv gone')));
    assert.deepEqual(io.states, ['checking', 'ok']);
  } finally {
    mock.timers.reset();
  }
});
