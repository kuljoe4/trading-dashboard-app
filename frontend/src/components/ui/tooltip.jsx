import React, { createContext, useContext, useState, useMemo } from 'react'
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "./utils"

const TooltipContext = createContext({
  activeTooltipId: null,
  setActiveTooltipId: () => {}
})

export const useTooltipContext = () => useContext(TooltipContext)

export const TooltipProvider = ({ children, ...props }) => {
  const [activeTooltipId, setActiveTooltipId] = useState(null)

  // Clear tooltip on navigation, escape, or any click outside
  React.useEffect(() => {
    const handleEvents = () => setActiveTooltipId(null);
    const handleKeydown = (e) => {
      if (e.key === 'Escape') setActiveTooltipId(null);
    };

    // Global listener to clear tooltips on any interaction
    const handleInteraction = (e) => {
      if (activeTooltipId) {
        // If we have an active tooltip, any click (mousedown) should clear it
        // This ensures the UI remains interactive and tooltips are transient
        setActiveTooltipId(null);
      }
    };

    window.addEventListener('hashchange', handleEvents);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('mousedown', handleInteraction, true);
    return () => {
      window.removeEventListener('hashchange', handleEvents);
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('mousedown', handleInteraction, true);
    };
  }, [activeTooltipId]);

  const value = useMemo(() => ({ activeTooltipId, setActiveTooltipId }), [activeTooltipId])

  return (
    <TooltipContext.Provider value={value}>
      <TooltipPrimitive.Provider {...props}>
        <div
          className={cn(
            "fixed inset-0 z-[80] bg-black/60 transition-all duration-300 pointer-events-none",
            activeTooltipId ? "opacity-100" : "opacity-0"
          )}
          aria-hidden="true"
        />
        {children}
      </TooltipPrimitive.Provider>
    </TooltipContext.Provider>
  )
}

export const Tooltip = ({ children, content, side = "top", align = "center", className, onOpenChange, ...props }) => {
  if (!content) return children;

  const id = React.useId();
  const { activeTooltipId, setActiveTooltipId } = useTooltipContext();

  const open = activeTooltipId === id;
  const setOpen = React.useCallback((isOpen) => {
    if (isOpen) setActiveTooltipId(id);
    else if (activeTooltipId === id) setActiveTooltipId(null);
    onOpenChange?.(isOpen);
  }, [id, activeTooltipId, setActiveTooltipId, onOpenChange]);

  // Cleanup: if the tooltip is unmounted while open, clear the active ID
  React.useEffect(() => {
    return () => {
      setActiveTooltipId(prev => prev === id ? null : prev);
    };
  }, [id, setActiveTooltipId]);

  return (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={setOpen}
      {...props}
    >
      <TooltipPrimitive.Trigger
        asChild
        onClick={(e) => {
          // On mobile/touch devices, toggle on click/tap
          // UX-REFINEMENT: Do NOT stop propagation. This allows the primary button action
          // to fire while the tooltip still toggles.
          if (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 768px)').matches) {
            setOpen(!open);
          }
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipContent side={side} align={align} className={className}>
        {content}
        <TooltipPrimitive.Arrow className="fill-border/50" />
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
};

export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = React.forwardRef(({ className, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={10}
      className={cn(
        "z-[9000] max-w-[calc(100vw-20px)] overflow-hidden break-words rounded-md bg-surface px-3 py-1.5 text-xs text-text border border-accent/20 shadow-[0_0_20px_rgba(0,0,0,0.3)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName
