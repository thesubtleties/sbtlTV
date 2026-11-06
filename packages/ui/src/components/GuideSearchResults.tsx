import { createContext, useEffect, useRef, useState } from 'react';
import { isAiringLive, matchRanges, type GuideAiring, type GuideSearchChannel, type GuideSearchResult } from '@sbtltv/core';
import './GuideSearchResults.css';

/** Programme ids to light up in the guide after a jump; null when not jumping. */
export const GuideHighlight = createContext<Set<string> | null>(null);

const CHANNELS_SHOWN = 3;

/** Every row the arrow keys can reach, in the order they show. */
export type GuideItem =
  | { id: string; kind: 'channel'; channel: GuideSearchChannel }
  | { id: 'more'; kind: 'more' }
  | { id: string; kind: 'airing'; airing: GuideAiring }
  | { id: string; kind: 'feed'; airing: GuideAiring; channel: GuideSearchChannel };

export function flattenResults(r: GuideSearchResult, allChannels: boolean, expandedKey: string | null): GuideItem[] {
  const channels = allChannels ? r.channels : r.channels.slice(0, CHANNELS_SHOWN);
  const items: GuideItem[] = channels.map((channel) => ({ id: `channel:${channel.stream_id}`, kind: 'channel', channel }));
  if (!allChannels && r.channelTotal > channels.length) items.push({ id: 'more', kind: 'more' });
  for (const airing of [...r.onNow, ...r.later, ...r.mentions]) {
    items.push({ id: `airing:${airing.key}`, kind: 'airing', airing });
    if (airing.key !== expandedKey) continue;
    for (const channel of airing.channels) items.push({ id: `feed:${airing.key}:${channel.stream_id}`, kind: 'feed', airing, channel });
  }
  return items;
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
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of matchRanges(text, query)) {
    out.push(text.slice(at, start), <mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

/** Starts near the first match, so a word deep in a description is in view. */
function snippet(text: string, query: string): string {
  const at = matchRanges(text, query)[0]?.[0] ?? 0;
  return at < 40 ? text : `…${text.slice(text.indexOf(' ', at - 30) + 1)}`;
}

function Logo({ channel }: { channel?: GuideSearchChannel }) {
  const [failed, setFailed] = useState(false);
  if (!channel?.stream_icon || failed) return <span className="gsr-logo gsr-logo--none">{channel?.name.slice(0, 2)}</span>;
  return <img className="gsr-logo" src={channel.stream_icon} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

interface Actions {
  onShowAllChannels: () => void;
  onToggleFeeds: (key: string) => void;
  onPickAiring: (a: GuideAiring) => void;
  onPickFeed: (a: GuideAiring, c: GuideSearchChannel) => void;
  onPickChannel: (c: GuideSearchChannel) => void;
}

function AiringRow({ airing, activeId, expanded, query, showDescription, onToggleFeeds, onPickAiring, onPickFeed }: {
  airing: GuideAiring; activeId: string | null; expanded: boolean; query: string; showDescription: boolean;
} & Pick<Actions, 'onToggleFeeds' | 'onPickAiring' | 'onPickFeed'>) {
  const now = Date.now();
  const live = isAiringLive(airing, now);
  const many = airing.channels.length > 1;
  const pct = Math.min(100, Math.max(0, ((now - airing.startMs) / (airing.endMs - airing.startMs)) * 100));
  const id = `airing:${airing.key}`;
  return (
    <div className={`gsr-row${activeId === id ? ' gsr-row--active' : ''}`} data-row={id}>
      <div className="gsr-row__line">
        <button className="gsr-row__main" tabIndex={-1} onClick={() => onPickAiring(airing)}>
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
            <span className="gsr-sub">
              {showDescription ? <Marked text={snippet(airing.description, query)} query={query} /> : airing.channels[0]?.name}
            </span>
          </span>
        </button>
        {many && (
          <button className="gsr-count" tabIndex={-1} onClick={() => onToggleFeeds(airing.key)}>
            {airing.channels.length} channels <span className={`gsr-chev${expanded ? ' gsr-chev--open' : ''}`}>›</span>
          </button>
        )}
      </div>
      {expanded && (
        <div className="gsr-feeds">
          {airing.channels.map((c) => {
            const feed = `feed:${airing.key}:${c.stream_id}`;
            return (
              <button key={c.stream_id} className={`gsr-feed${activeId === feed ? ' gsr-row--active' : ''}`} data-row={feed} tabIndex={-1} onClick={() => onPickFeed(airing, c)}>
                <Logo channel={c} /><span>{c.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GuideSearchResults({ results, query, activeId, allChannels, expandedKey, onShowAllChannels, onToggleFeeds, onPickAiring, onPickFeed, onPickChannel }: {
  results: GuideSearchResult; query: string; activeId: string | null; allChannels: boolean; expandedKey: string | null;
} & Actions) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeId) return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [];
    [...rows].find((el) => el.dataset.row === activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const channels = allChannels ? results.channels : results.channels.slice(0, CHANNELS_SHOWN);
  const capped = results.channels.length < results.channelTotal;
  const row = (a: GuideAiring, showDescription = false) => (
    <AiringRow key={a.key} airing={a} activeId={activeId} expanded={a.key === expandedKey} query={query} showDescription={showDescription}
      onToggleFeeds={onToggleFeeds} onPickAiring={onPickAiring} onPickFeed={onPickFeed} />
  );
  const empty = !channels.length && !results.onNow.length && !results.later.length && !results.mentions.length;
  return (
    <div className="gsr-list" ref={listRef}>
      {empty && <div className="gsr-empty">Nothing on the guide for "{query.trim()}"</div>}
      {channels.length > 0 && (
        <section className="gsr-section">
          <h3>Channels</h3>
          {channels.map((c) => {
            const id = `channel:${c.stream_id}`;
            return (
              <button key={c.stream_id} className={`gsr-channel${activeId === id ? ' gsr-row--active' : ''}`} data-row={id} tabIndex={-1} onClick={() => onPickChannel(c)}>
                <Logo channel={c} /><span className="gsr-channel__name"><Marked text={c.name} query={query} /></span>
              </button>
            );
          })}
          {!allChannels && results.channelTotal > channels.length && (
            <button className={`gsr-more${activeId === 'more' ? ' gsr-row--active' : ''}`} data-row="more" tabIndex={-1} onClick={onShowAllChannels}>
              {capped ? `Show ${results.channels.length} of ${results.channelTotal}` : `Show all ${results.channelTotal}`}
            </button>
          )}
          {allChannels && capped && <div className="gsr-note">{results.channels.length} of {results.channelTotal} shown. Type more to narrow it.</div>}
        </section>
      )}
      {results.onNow.length > 0 && <section className="gsr-section"><h3>On now</h3>{results.onNow.map((a) => row(a))}</section>}
      {results.later.length > 0 && <section className="gsr-section"><h3>Later</h3>{results.later.map((a) => row(a))}</section>}
      {results.mentions.length > 0 && <section className="gsr-section"><h3>Also mentions</h3>{results.mentions.map((a) => row(a, true))}</section>}
    </div>
  );
}
