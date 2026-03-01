import { useCallback } from 'react';
import type { Source } from '../../types/electron';
import { useUIStore, useUpdateSettings } from '../../stores/uiStore';
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/react';
import { useSortable, isSortable } from '@dnd-kit/react/sortable';

// Sortable source item for priority lists
function SortableSourceItem({ id, index, name, type, disabled }: { id: string; index: number; name: string; type: string; disabled?: boolean }) {
  const { ref, isDragSource } = useSortable({ id, index });

  const classes = ['priority-item'];
  if (isDragSource) classes.push('dragging');
  if (disabled) classes.push('disabled');

  return (
    <div ref={ref} className={classes.join(' ')}>
      <span className="priority-grip">⠿</span>
      <span className="priority-name">{name}</span>
      <span className="priority-type">{type.toUpperCase()}</span>
    </div>
  );
}

// Drag-and-drop priority list
function SourcePriorityList({
  title,
  description,
  sourceIds,
  sources,
  onReorder,
}: {
  title: string;
  description: string;
  sourceIds: string[];
  sources: Source[];
  onReorder: (newOrder: string[]) => void;
}) {
  const handleDragEnd = useCallback(({ operation }: Parameters<DragEndEvent>[0]) => {
    if (isSortable(operation.source)) {
      const from = operation.source.sortable.initialIndex;
      const to = operation.source.sortable.index;
      if (from !== to) {
        const newOrder = [...sourceIds];
        const [moved] = newOrder.splice(from, 1);
        newOrder.splice(to, 0, moved);
        onReorder(newOrder);
      }
    }
  }, [sourceIds, onReorder]);

  if (sourceIds.length < 2) return null;

  return (
    <div className="priority-list-section">
      <h4>{title}</h4>
      <p className="priority-description">{description}</p>
      <DragDropProvider onDragEnd={handleDragEnd}>
        <div className="priority-list">
          {sourceIds.map((id, index) => {
            const source = sources.find(s => s.id === id);
            if (!source) return null;
            return (
              <SortableSourceItem
                key={id}
                id={id}
                index={index}
                name={source.name}
                type={source.type}
                disabled={!source.enabled}
              />
            );
          })}
        </div>
      </DragDropProvider>
    </div>
  );
}

interface PriorityTabProps {
  sources: Source[];
}

export function PriorityTab({ sources }: PriorityTabProps) {
  const updateSettings = useUpdateSettings();

  // Source ordering state from settings
  const liveSourceOrder = useUIStore((s) => s.settings.liveSourceOrder);
  const vodSourceOrder = useUIStore((s) => s.settings.vodSourceOrder);

  // Compute effective live order: custom order (all sources, including disabled) or insertion order
  const allXtream = sources.filter(s => s.type === 'xtream');
  const effectiveLiveOrder = (() => {
    const filtered = liveSourceOrder?.filter(id => sources.some(s => s.id === id)) ?? [];
    const missing = sources.filter(s => !filtered.includes(s.id)).map(s => s.id);
    const merged = [...filtered, ...missing];
    return merged.length >= 2 ? merged : sources.map(s => s.id);
  })();
  const effectiveVodOrder = (() => {
    const filtered = vodSourceOrder?.filter(id => allXtream.some(s => s.id === id)) ?? [];
    const missing = allXtream.filter(s => !filtered.includes(s.id)).map(s => s.id);
    const merged = [...filtered, ...missing];
    return merged.length >= 2 ? merged : allXtream.map(s => s.id);
  })();

  function handleLiveReorder(newOrder: string[]) {
    updateSettings({ liveSourceOrder: newOrder });
    window.storage?.updateSettings({ liveSourceOrder: newOrder });
  }

  function handleVodReorder(newOrder: string[]) {
    updateSettings({ vodSourceOrder: newOrder });
    window.storage?.updateSettings({ vodSourceOrder: newOrder });
  }

  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <div className="section-header">
          <h3>Source Priority</h3>
        </div>
        <p className="section-description">
          Drag to reorder. Higher sources are preferred when content exists in multiple sources.
          Disabled sources appear dimmed but can still be reordered.
        </p>
        <SourcePriorityList
          title="Live TV"
          description="Priority for live channels across all source types"
          sourceIds={effectiveLiveOrder}
          sources={sources}
          onReorder={handleLiveReorder}
        />
        <SourcePriorityList
          title="Movies & Series"
          description="Priority for VOD content (Xtream sources only)"
          sourceIds={effectiveVodOrder}
          sources={sources}
          onReorder={handleVodReorder}
        />
      </div>
    </div>
  );
}
