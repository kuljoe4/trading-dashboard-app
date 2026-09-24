import { useRef, useCallback, useState } from 'react';

export function useZoomSlider({
  rangeSpan,
  setRangeSpan,
  setActivePreset,
  minSpan = 2.0
}) {
  const brushRef = useRef(null);
  const dragStateRef = useRef({
    isDragging: false,
    type: null,
    startX: 0,
    startSpan: [0, 100],
    pointerId: null
  });

  const [isDraggingBrush, setIsDraggingBrush] = useState(false);

  const handlePointerDown = useCallback((e, type) => {
    e.stopPropagation();
    if (!brushRef.current) return;

    const pointerId = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(pointerId);
    } catch (_) {}

    dragStateRef.current = {
      isDragging: true,
      type,
      startX: e.clientX,
      startSpan: [...rangeSpan],
      pointerId
    };
    setIsDraggingBrush(type);
  }, [rangeSpan]);

  const handleBrushMouseDown = useCallback((e, type) => handlePointerDown(e, type), [handlePointerDown]);

  const handlePointerMove = useCallback((e) => {
    if (!dragStateRef.current.isDragging || !brushRef.current) return;
    const rect = brushRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const deltaX = e.clientX - dragStateRef.current.startX;
    const deltaPct = (deltaX / rect.width) * 100;
    const [start0, start1] = dragStateRef.current.startSpan;
    const type = dragStateRef.current.type;

    if (type === 'left') {
      const newStart = Math.max(0, Math.min(start1 - minSpan, start0 + deltaPct));
      setRangeSpan([newStart, start1]);
      if (setActivePreset) setActivePreset('Custom');
    } else if (type === 'right') {
      const newEnd = Math.min(100, Math.max(start0 + minSpan, start1 + deltaPct));
      setRangeSpan([start0, newEnd]);
      if (setActivePreset) setActivePreset('Custom');
    } else if (type === 'move') {
      const spanWidth = start1 - start0;
      let newStart = start0 + deltaPct;
      let newEnd = start1 + deltaPct;

      if (newStart < 0) {
        newStart = 0;
        newEnd = spanWidth;
      }
      if (newEnd > 100) {
        newEnd = 100;
        newStart = 100 - spanWidth;
      }
      setRangeSpan([newStart, newEnd]);
      if (setActivePreset) setActivePreset('Custom');
    }
  }, [minSpan, setRangeSpan, setActivePreset]);

  const handlePointerUp = useCallback((e) => {
    if (dragStateRef.current.isDragging) {
      try {
        if (e.currentTarget && e.pointerId !== undefined) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      dragStateRef.current.isDragging = false;
      setIsDraggingBrush(false);
    }
  }, []);

  const handleTrackClick = useCallback((e) => {
    if (dragStateRef.current.isDragging || !brushRef.current) return;
    const rect = brushRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const clickX = e.clientX - rect.left;
    const clickPct = (clickX / rect.width) * 100;
    const currentWidth = rangeSpan[1] - rangeSpan[0];

    let newStart = clickPct - currentWidth / 2;
    let newEnd = clickPct + currentWidth / 2;

    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(100, currentWidth);
    }
    if (newEnd > 100) {
      newEnd = 100;
      newStart = Math.max(0, 100 - currentWidth);
    }
    setRangeSpan([newStart, newEnd]);
    if (setActivePreset) setActivePreset('Custom');
  }, [rangeSpan, setRangeSpan, setActivePreset]);

  return {
    brushRef,
    isDraggingBrush,
    handlePointerDown,
    handleBrushMouseDown,
    handlePointerMove,
    handlePointerUp,
    handleTrackClick
  };
}
