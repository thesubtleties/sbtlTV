import { memo, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ProgramLane } from './ProgramLane';
import { isProgramCurrent } from './ProgramBlock';
import { onNow } from '../utils/onNow';
import { timeLeft } from '../utils/airTime';
import { GuideHover } from './guideHover';
import { useIsFavoriteChannel, useToggleFavoriteChannel } from '../hooks/useFavorites';
import type { StoredChannel, StoredProgram } from '../db';

interface ChannelRowProps {
  channel: StoredChannel;
  index: number;
  sortOrder: 'alphabetical' | 'number';
  channelColumnWidth: number;
  // undefined while this row's programs have not been read yet; [] when the channel has no EPG
  programs: StoredProgram[] | undefined;
  /**
   * What's on right now, whatever time the grid shows (from the guide's own lookup). Not read yet, or not current
   * any more (an answer from the minute before), and the row's own programs are used instead.
   */
  nowProgram?: StoredProgram;
  /** The setting: the show on now and its progress under the name. Off: the name only. */
  showNow: boolean;
  windowStart: Date;
  windowEnd: Date;
  /** The guide's minute tick: what is on now */
  now: Date;
  pixelsPerHour: number;
  visibleHours: number;
  onPlay: (channel: StoredChannel) => void;
}

/** A little room after a sliding name's last letter, and how fast it travels (px a second, there and back) */
const MARQUEE_END_PX = 6;
/** A name over by this much or less shows whole (clipped by a sliver of its last letter), with no ellipsis or slide */
const NAME_NEAR_FIT_PX = 8;
const MARQUEE_PX_PER_S = 60;

export const ChannelRow = memo(function ChannelRow({
  channel,
  index,
  sortOrder,
  channelColumnWidth,
  programs,
  nowProgram,
  showNow,
  windowStart,
  windowEnd,
  now,
  pixelsPerHour,
  visibleHours,
  onPlay,
}: ChannelRowProps) {
  // Bound here rather than in ChannelPanel so the memo above sees a stable prop.
  const handlePlay = useCallback(() => onPlay(channel), [onPlay, channel]);
  const isFavorite = useIsFavoriteChannel(channel.stream_id);
  const toggleFavorite = useToggleFavoriteChannel();
  const handleToggleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(channel.stream_id, channel.name);
  }, [toggleFavorite, channel.stream_id, channel.name]);
  // The on-now line lands with the row: grows in when the row's programs morph in, otherwise fades in in place.
  // A line already showing when the morph starts stays as it is (no snap back to grow), and once grown the class
  // goes, so a later remount of the line doesn't replay the morph's delayed grow.
  const [morphed, setMorphed] = useState(false);
  const lineShown = useRef(false);
  const handleMorph = useCallback(() => { if (!lineShown.current) setMorphed(true); }, []);
  const handleLineGrown = useCallback(() => setMorphed(false), []);
  // The lookup's answer when it's for now; otherwise (not read yet, nothing on in it, or a minute old) the row's own
  // programs, so a show that has just started appears at once and a cell never blinks out while the next is read.
  // null (no EPG, nothing on, or the setting off): just the name.
  const live = nowProgram && isProgramCurrent(nowProgram, now) ? nowProgram : programs?.find((p) => isProgramCurrent(p, now));
  const on = showNow ? onNow(live, now) : null;
  lineShown.current = on !== null;
  // Fades in only when the show arrives after the row is on screen (a fresh load, or a show starting after a gap);
  // a row rebuilt by scrolling, with its show already read, shows it at once like its name and programs
  const [hadShowOnMount] = useState(on !== null);
  const hover = useContext(GuideHover);
  // A cut-off name slides to its end and back while the row is hovered (as long titles on the Movies/Series cards):
  // by exactly what's hidden, so it works at any channel column width (re-measured when the column is resized)
  const nameRef = useRef<HTMLSpanElement>(null);
  const [nameHidden, setNameHidden] = useState(0);
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    const measure = () => setNameHidden(Math.max(0, el.scrollWidth - el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [channel.name]);
  // Only a sliver over (the edge of the last letter): no ellipsis (it would hide more than the overflow) and no slide
  const nameSlides = nameHidden > NAME_NEAR_FIT_PX;
  const marquee: CSSProperties | undefined = nameSlides
    ? { '--marquee': `${-(nameHidden + MARQUEE_END_PX)}px`, '--marquee-dur': `${Math.max(2.4, (nameHidden + MARQUEE_END_PX) / MARQUEE_PX_PER_S * 2.5)}s` }
    : undefined;
  // Show channel_num when sorting by number, otherwise show list position
  const displayNumber = sortOrder === 'number' && channel.channel_num !== undefined
    ? channel.channel_num
    : index + 1;

  return (
    <div className="guide-channel-row">
      {/* Channel info column */}
      <div
        className="guide-channel-info"
        style={{ width: channelColumnWidth, minWidth: channelColumnWidth }}
        onClick={handlePlay}
      >
        <span className="guide-channel-number">{displayNumber}</span>
        <div className="guide-channel-logo">
          {channel.stream_icon ? (
            <img
              src={channel.stream_icon}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span className="logo-placeholder">{channel.name.charAt(0)}</span>
          )}
        </div>
        <div className="guide-channel-text">
          <span ref={nameRef} className={`guide-channel-name${nameSlides ? ' guide-channel-name--overflow' : nameHidden > 0 ? ' guide-channel-name--near-fit' : ''}`} style={marquee}>
            <span className="guide-channel-name__inner">{channel.name}</span>
          </span>
          {on && (
            <span
              className={`guide-channel-now${morphed ? ' guide-channel-now--morph' : ''}${hadShowOnMount ? ' guide-channel-now--instant' : ''}`}
              aria-description={`On now, ${timeLeft(on.program.end.getTime(), now.getTime())}`}
              onMouseEnter={(e) => hover?.show(on.program, e.currentTarget, e.clientX)}
              onMouseLeave={() => hover?.hide()}
            >
              <span className="guide-channel-now-title" dir="auto">{on.program.title}</span>
              <span className="guide-channel-now-line" aria-hidden="true">
                <span style={{ width: `${on.pct}%` }} onAnimationEnd={morphed ? handleLineGrown : undefined} />
              </span>
            </span>
          )}
        </div>
        <button
          className={`channel-fav-btn${isFavorite ? ' active' : ''}`}
          onClick={handleToggleFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {isFavorite ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />
            </svg>
          )}
        </button>
      </div>

      {/* Program grid */}
      <div className="guide-program-grid">
        <ProgramLane
          programs={programs}
          rowIndex={index}
          windowStart={windowStart}
          windowEnd={windowEnd}
          now={now}
          pixelsPerHour={pixelsPerHour}
          visibleHours={visibleHours}
          onPlay={handlePlay}
          onMorph={handleMorph}
        />
      </div>
    </div>
  );
});
