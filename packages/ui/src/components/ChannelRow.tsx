import { memo, useCallback } from 'react';
import { ProgramBlock, EmptyProgramBlock } from './ProgramBlock';
import { useIsFavoriteChannel, useToggleFavoriteChannel } from '../hooks/useFavorites';
import type { StoredChannel, StoredProgram } from '../db';

// Width of the channel info column (must match ChannelPanel)
const CHANNEL_COLUMN_WIDTH = 280;

interface ChannelRowProps {
  channel: StoredChannel;
  index: number;
  sortOrder: 'alphabetical' | 'number';
  programs: StoredProgram[];
  windowStart: Date;
  windowEnd: Date;
  pixelsPerHour: number;
  visibleHours: number;
  onPlay: () => void;
}

export const ChannelRow = memo(function ChannelRow({
  channel,
  index,
  sortOrder,
  programs,
  windowStart,
  windowEnd,
  pixelsPerHour,
  visibleHours,
  onPlay,
}: ChannelRowProps) {
  const isFavorite = useIsFavoriteChannel(channel.stream_id);
  const toggleFavorite = useToggleFavoriteChannel();
  const handleToggleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(channel.stream_id, channel.name);
  }, [toggleFavorite, channel.stream_id, channel.name]);
  // Show channel_num when sorting by number, otherwise show list position
  const displayNumber = sortOrder === 'number' && channel.channel_num !== undefined
    ? channel.channel_num
    : index + 1;

  return (
    <div className="guide-channel-row">
      {/* Channel info column */}
      <div
        className="guide-channel-info"
        style={{ width: CHANNEL_COLUMN_WIDTH, minWidth: CHANNEL_COLUMN_WIDTH }}
        onClick={onPlay}
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
        <span className="guide-channel-name">{channel.name}</span>
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
        {programs.length > 0 ? (
          programs.map((program) => (
            <ProgramBlock
              key={program.id}
              program={program}
              windowStart={windowStart}
              windowEnd={windowEnd}
              pixelsPerHour={pixelsPerHour}
              onClick={onPlay}
            />
          ))
        ) : (
          <EmptyProgramBlock pixelsPerHour={pixelsPerHour} visibleHours={visibleHours} />
        )}
      </div>
    </div>
  );
});
