import React, { useState, useCallback, useMemo } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical, RotateCcw } from 'lucide-react';
import { cn } from '../ui/primitives';
import {
  TAB_SECTION_DEFAULTS,
  normalizeSectionOrder,
  moveSectionInOrder,
  mergeVisibleReorder,
  isCustomSectionOrder,
} from '../../utils/configSectionOrder.js';

const DraggableSectionItem = React.memo(({
  id,
  index,
  total,
  title,
  onMove,
  children,
}) => {
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    dragControls.start(e);
  }, [dragControls]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      e.stopPropagation();
      onMove(id, 'up');
    } else if (e.key === 'ArrowDown' && index < total - 1) {
      e.preventDefault();
      e.stopPropagation();
      onMove(id, 'down');
    } else if (e.key === 'Home' && index > 0) {
      e.preventDefault();
      e.stopPropagation();
      onMove(id, 'top');
    } else if (e.key === 'End' && index < total - 1) {
      e.preventDefault();
      e.stopPropagation();
      onMove(id, 'bottom');
    }
  }, [id, index, total, onMove]);

  const dragHandle = (
    <button
      type="button"
      data-drag-handle="true"
      data-section-id={id}
      onPointerDown={handlePointerDown}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      aria-label={`Reorder ${title || id}. Drag or press Up and Down arrows.`}
      aria-roledescription="sortable"
      title="Drag to reorder (or focus and use Up/Down arrows)"
      className={cn(
        'w-7 h-7 sm:w-6 sm:h-6 rounded-md flex items-center justify-center shrink-0 touch-none select-none transition-colors cursor-grab active:cursor-grabbing',
        'text-dim/55 hover:text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        isDragging && 'text-accent bg-accent/15',
      )}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  );

  return (
    <Reorder.Item
      as="div"
      value={id}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      whileDrag={{
        scale: 1.006,
        boxShadow: '0 12px 28px -8px rgba(0, 0, 0, 0.45)',
        zIndex: 30,
      }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className={cn(
        'relative w-full min-w-0 rounded-xl',
        isDragging && 'z-30 ring-1 ring-accent/50',
      )}
    >
      {typeof children === 'function' ? children(dragHandle, isDragging) : children}
    </Reorder.Item>
  );
});
DraggableSectionItem.displayName = 'DraggableSectionItem';

export const DraggableSectionList = React.memo(({
  tabId,
  order,
  sectionsMap,
  onReorder,
  onReset,
  getSectionProps,
  className = 'flex flex-col gap-3',
}) => {
  const defaultIds = useMemo(
    () => TAB_SECTION_DEFAULTS[tabId] || Object.keys(sectionsMap || {}),
    [tabId, sectionsMap]
  );

  const normalizedOrder = useMemo(
    () => normalizeSectionOrder(tabId, order, defaultIds),
    [tabId, order, defaultIds]
  );

  const visibleIds = useMemo(
    () => normalizedOrder.filter((id) => Boolean(sectionsMap?.[id])),
    [normalizedOrder, sectionsMap]
  );

  const handleGroupReorder = useCallback((nextVisibleOrder) => {
    if (!onReorder) return;
    const merged = mergeVisibleReorder(normalizedOrder, nextVisibleOrder);
    onReorder(tabId, normalizeSectionOrder(tabId, merged, defaultIds));
  }, [tabId, normalizedOrder, defaultIds, onReorder]);

  const handleMove = useCallback((sectionId, direction) => {
    if (!onReorder) return;
    const nextVisible = moveSectionInOrder(visibleIds, sectionId, direction);
    const merged = mergeVisibleReorder(normalizedOrder, nextVisible);
    onReorder(tabId, normalizeSectionOrder(tabId, merged, defaultIds));
  }, [tabId, visibleIds, normalizedOrder, defaultIds, onReorder]);

  const isCustom = useMemo(
    () => isCustomSectionOrder(tabId, normalizedOrder, defaultIds),
    [tabId, normalizedOrder, defaultIds]
  );

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
      <Reorder.Group
        as="div"
        axis="y"
        values={visibleIds}
        onReorder={handleGroupReorder}
        className={className}
      >
        {visibleIds.map((id, index) => {
          const el = sectionsMap[id];
          if (!el) return null;
          const title = el.props?.title || id;
          const extraProps = typeof getSectionProps === 'function' ? getSectionProps(id) : {};
          return (
            <DraggableSectionItem
              key={id}
              id={id}
              index={index}
              total={visibleIds.length}
              title={title}
              onMove={handleMove}
            >
              {(dragHandle, isDragging) => React.cloneElement(el, {
                dragHandle,
                isDragging,
                ...extraProps,
              })}
            </DraggableSectionItem>
          );
        })}
      </Reorder.Group>

      {isCustom && onReset && (
        <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
          <span className="text-[10px] text-dim/70 font-medium">
            Custom section order saved
          </span>
          <button
            type="button"
            onClick={() => onReset(tabId)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-dim hover:text-accent transition-colors cursor-pointer rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <RotateCcw size={11} aria-hidden="true" />
            <span>Reset order</span>
          </button>
        </div>
      )}
    </div>
  );
});
DraggableSectionList.displayName = 'DraggableSectionList';
