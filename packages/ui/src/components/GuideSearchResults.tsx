import { createContext, useEffect, useRef, useState } from 'react';
import { isAiringLive, type GuideAiring, type GuideSearchChannel, type GuideSearchResult } from '@sbtltv/core';
import './GuideSearchResults.css';

/** Programme ids to light up in the guide after a jump; null when not jumping. */
export const GuideHighlight = createContext<Set<string> | null>(null);

const CHANNELS_SHOWN = 3;

export type GuideItem = { kind: 'channel'; channel: GuideSearchChannel } | { kind: 'airing'; airing: GuideAiring };

export function flattenResults(r: GuideSearchResult, allChannels: boolean): GuideItem[] {
  const channels = allChannels ? r.channels : r.channels.slice(0, CHANNELS_SHOWN);
  return [
    ...channels.map((channel) => ({ kind: 'channel' as const, channel })),
    ...[...r.onNow, ...r.later, ...r.mentions].map((airing) => ({ kind: 'airing' as const, airing })),
  ];
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayLabel(ms: number, now: number): string {
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : new Date(ms).toLocaleDateString([], { weekday: 'long' });
}
function timeLeft(endMs: number, now: number): string {
  const left = Math.max(1, Math.round((endMs - now) / 60000));
  return left >= 60 ? `${Math.floor(left / 60)}h ${left % 60}m left` : `${left}m left`;
}

function Marked({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(\\b(?:${words.join('|')})[\\p{L}\\p{N}]*)`, 'giu'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

function snippet(text: string, query: string): string {
  const first = query.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const at = text.toLowerCase().indexOf(first);
  return at < 60 ? text : `…${text.slice(at - 40)}`;
}

function Logo({ channel }: { channel?: GuideSearchChannel }) {
  const [failed, setFailed] = useState(false);
  if (!channel?.stream_icon || failed) return <span className="gsr-logo gsr-logo--none">{channel?.name.slice(0, 2)}</span>;
  return <img className="gsr-logo" src={channel.stream_icon} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

interface Actions {
  onPickAiring: (a: GuideAiring) => void;
  onPickFeed: (a: GuideAiring, c: GuideSearchChannel) => void;
  onPickChannel: (c: GuideSearchChannel) => void;
}

function AiringRow({ airing, active, query, showDescription, onPickAiring, onPickFeed }: {
  airing: GuideAiring; active: boolean; query: string; showDescription: boolean;
} & Pick<Actions, 'onPickAiring' | 'onPickFeed'>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const now = Date.now();
  const live = isAiringLive(airing, now);
  const many = airing.channels.length > 1;
  const pct = Math.min(100, Math.max(0, ((now - airing.startMs) / (airing.endMs - airing.startMs)) * 100));
  return (
    <div className={`gsr-row${active ? ' gsr-row--active' : ''}`} ref={ref}>
      <button className="gsr-row__main" onClick={() => (live && many ? setOpen(!open) : onPickAiring(airing))}>
        <span className="gsr-when">
          {live ? (
            <>
              <span className="gsr-when__left">{timeLeft(airing.endMs, now)}</span>
              <span className="gsr-bar"><span style={{ width: `${pct}%` }} /></span>
            </>
          ) : (
            <>
              <span className="gsr-when__time">{clock(airing.startMs)}</span>
              <span className="gsr-when__day">{dayLabel(airing.startMs, now)}</span>
            </>
          )}
        </span>
        <Logo channel={airing.channels[0]} />
        <span className="gsr-text">
          <span className="gsr-title"><Marked text={airing.title} query={query} /></span>
          {showDescription
            ? <span className="gsr-sub"><Marked text={snippet(airing.description, query)} query={query} /></span>
            : <span className="gsr-sub">{airing.channels[0]?.name}</span>}
        </span>
        {many && (
          <span className="gsr-count" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            {airing.channels.length} channels <span className={`gsr-chev${open ? ' gsr-chev--open' : ''}`}>›</span>
          </span>
        )}
      </button>
      {open && (
        <div className="gsr-feeds">
          {airing.channels.map((c) => (
            <button key={c.stream_id} className="gsr-feed" onClick={() => onPickFeed(airing, c)}>
              <Logo channel={c} /><span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GuideSearchResults({ results, query, activeIndex, allChannels, onShowAllChannels, onPickAiring, onPickFeed, onPickChannel }: {
  results: GuideSearchResult; query: string; activeIndex: number; allChannels: boolean; onShowAllChannels: () => void;
} & Actions) {
  const channels = allChannels ? results.channels : results.channels.slice(0, CHANNELS_SHOWN);
  const onNowAt = channels.length;
  const laterAt = onNowAt + results.onNow.length;
  const mentionsAt = laterAt + results.later.length;
  const row = (a: GuideAiring, i: number, showDescription = false) => (
    <AiringRow key={a.key} airing={a} active={i === activeIndex} query={query} showDescription={showDescription} onPickAiring={onPickAiring} onPickFeed={onPickFeed} />
  );
  const empty = !channels.length && !results.onNow.length && !results.later.length && !results.mentions.length;
  return (
    <div className="gsr-list">
      {empty && <div className="gsr-empty">Nothing on the guide for "{query.trim()}"</div>}
      {channels.length > 0 && (
        <section className="gsr-section">
          <h3>Channels</h3>
          {channels.map((c, i) => (
            <button key={c.stream_id} className={`gsr-channel${i === activeIndex ? ' gsr-row--active' : ''}`} onClick={() => onPickChannel(c)}>
              <Logo channel={c} /><span><Marked text={c.name} query={query} /></span>
            </button>
          ))}
          {!allChannels && results.channelTotal > channels.length && (
            <button className="gsr-more" onClick={onShowAllChannels}>Show all {results.channelTotal}</button>
          )}
        </section>
      )}
      {results.onNow.length > 0 && <section className="gsr-section"><h3>On now</h3>{results.onNow.map((a, i) => row(a, onNowAt + i))}</section>}
      {results.later.length > 0 && <section className="gsr-section"><h3>Later</h3>{results.later.map((a, i) => row(a, laterAt + i))}</section>}
      {results.mentions.length > 0 && <section className="gsr-section"><h3>Also mentions</h3>{results.mentions.map((a, i) => row(a, mentionsAt + i, true))}</section>}
    </div>
  );
}
