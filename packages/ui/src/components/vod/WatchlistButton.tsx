import { useCallback } from 'react';
import { useIsOnWatchlist, useToggleWatchlist } from '../../hooks/useWatchlist';

interface WatchlistButtonProps {
  type: 'movie' | 'series';
  tmdbId?: number;
  streamId?: string;
  name: string;
  className?: string;
}

const heartOutline = 'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572';
const heartFilled = 'M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z';

export function WatchlistButton({ type, tmdbId, streamId, name, className = '' }: WatchlistButtonProps) {
  const onWatchlist = useIsOnWatchlist(type, tmdbId, streamId);
  const toggle = useToggleWatchlist();

  const handleClick = useCallback(() => {
    toggle(type, { tmdbId, streamId, name });
  }, [toggle, type, tmdbId, streamId, name]);

  return (
    <button
      className={`${className || 'watchlist-btn'}${onWatchlist ? ' active' : ''}`}
      onClick={handleClick}
    >
      {onWatchlist ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d={heartFilled} />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d={heartOutline} />
        </svg>
      )}
      {onWatchlist ? 'On Watchlist' : 'Watchlist'}
    </button>
  );
}
