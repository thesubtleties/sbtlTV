import { useState, useEffect, useMemo } from 'react';
import { useChannels, useCategories, usePrograms } from '../hooks/useChannels';
import type { StoredChannel } from '../db';
import './ChannelPanel.css';

interface ChannelPanelProps {
  categoryId: string | null;
  visible: boolean;
  categoryStripOpen: boolean;
  sidebarExpanded: boolean;
  onPlayChannel: (channel: StoredChannel) => void;
  onClose: () => void;
}

export function ChannelPanel({
  categoryId,
  visible,
  categoryStripOpen,
  sidebarExpanded,
  onPlayChannel,
  onClose,
}: ChannelPanelProps) {
  const channels = useChannels(categoryId);
  const categories = useCategories();
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Get stream IDs for programs lookup (EPG is synced at startup, just query local DB)
  const streamIds = useMemo(() => channels.map((ch) => ch.stream_id), [channels]);
  const programs = usePrograms(streamIds);

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Get current category name
  const currentCategory = categoryId
    ? categories.find((c) => c.category_id === categoryId)
    : null;
  const categoryName = currentCategory?.category_name ?? 'All Channels';

  // Format time
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Generate time slots for the header (current hour + next 3 hours)
  const getTimeSlots = () => {
    const slots = [];
    const now = new Date();
    now.setMinutes(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const slot = new Date(now.getTime() + i * 60 * 60 * 1000);
      slots.push(slot);
    }
    return slots;
  };

  const timeSlots = getTimeSlots();

  return (
    <div
      className={`guide-panel ${visible ? 'visible' : 'hidden'} ${categoryStripOpen ? 'with-categories' : ''} ${sidebarExpanded ? 'sidebar-expanded' : ''}`}
    >
      {/* Top Bar - Time Display */}
      <div className="guide-header">
        <div className="guide-header-left">
          <span className="guide-current-time">{formatTime(currentTime)}</span>
          <span className="guide-category">{categoryName}</span>
          <span className="guide-channel-count">{channels.length} channels</span>
        </div>
        <div className="guide-header-right">
          <div className="guide-time-slots">
            {timeSlots.map((slot, i) => (
              <span key={i} className={`time-slot ${i === 0 ? 'current' : ''}`}>
                {formatTime(slot)}
              </span>
            ))}
          </div>
          <button className="guide-close" onClick={onClose} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* EPG Grid Area */}
      <div className="guide-content">
        {/* Channel List */}
        <div className="guide-channels">
          {channels.map((channel, index) => (
            <div
              key={channel.stream_id}
              className={`guide-channel-row ${hoveredChannel === channel.stream_id ? 'hovered' : ''}`}
              onMouseEnter={() => setHoveredChannel(channel.stream_id)}
              onMouseLeave={() => setHoveredChannel(null)}
              onClick={() => onPlayChannel(channel)}
            >
              <div className="guide-channel-info">
                <span className="guide-channel-number">{index + 1}</span>
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
              </div>

              {/* EPG Program Bar */}
              <div className="guide-program-bar">
                {(() => {
                  const program = programs.get(channel.stream_id);
                  if (program) {
                    return (
                      <div className="guide-program current">
                        <span className="program-title">{program.title}</span>
                        {program.description && (
                          <span className="program-desc">{program.description}</span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div className="guide-program">
                      <span className="program-title">No EPG Data</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          ))}

          {channels.length === 0 && (
            <div className="guide-empty">
              <div className="guide-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="7" width="20" height="13" rx="2" />
                  <path d="M17 2l-5 5-5-5" />
                </svg>
              </div>
              <h3>No Channels</h3>
              <p>Sync your sources to load channels</p>
              <p className="hint">Go to Settings → Add a source → Channels will sync automatically</p>
            </div>
          )}
        </div>
      </div>

      {/* Current Time Indicator Line */}
      <div className="guide-time-indicator" />
    </div>
  );
}
