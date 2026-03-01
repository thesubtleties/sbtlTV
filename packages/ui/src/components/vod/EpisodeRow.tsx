import { memo } from 'react';
import type { StoredEpisode } from '../../db';

interface EpisodeRowProps {
  episode: StoredEpisode;
  progress: number; // 0-100
  onPlay: (episode: StoredEpisode) => void;
}

export const EpisodeRow = memo(function EpisodeRow({ episode, progress, onPlay }: EpisodeRowProps) {
  const watched = progress >= 90;

  return (
    <button
      className="series-detail__episode"
      onClick={() => onPlay(episode)}
    >
      <span className="series-detail__episode-number">
        {episode.episode_num}
      </span>
      <div className="series-detail__episode-info">
        <span className="series-detail__episode-title">
          {episode.title || `Episode ${episode.episode_num}`}
        </span>
        {(episode.duration ?? (typeof episode.info?.duration === 'number' ? episode.info.duration : undefined)) ? (
          <span className="series-detail__episode-duration">
            {Math.round((episode.duration ?? Number(episode.info?.duration) ?? 0) / 60)}m
          </span>
        ) : null}
      </div>
      {watched ? (
        <svg
          className="series-detail__episode-watched"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M12 4c4.29 0 7.863 2.429 10.665 7.154l.22 .379l.045 .1l.03 .083l.014 .055l.014 .082l.011 .1v.11l-.014 .111a.992 .992 0 0 1 -.026 .11l-.039 .108l-.036 .075l-.016 .03c-2.764 4.836 -6.3 7.38 -10.555 7.499l-.313 .004c-4.396 0 -8.037 -2.549 -10.868 -7.504a1 1 0 0 1 0 -.992c2.831 -4.955 6.472 -7.504 10.868 -7.504zm0 5a3 3 0 1 0 0 6a3 3 0 0 0 0 -6" />
        </svg>
      ) : (
        <svg
          className="series-detail__episode-play"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" />
        </svg>
      )}
      {progress > 0 && progress < 90 && (
        <div className="series-detail__episode-progress">
          <div className="series-detail__episode-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </button>
  );
});
