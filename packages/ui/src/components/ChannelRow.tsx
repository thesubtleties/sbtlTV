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
          {isFavorite ? '\u2665' : '\u2661'}
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
