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

  // Clear tooltip on navigation or when Escape is pressed
  React.useEffect(() => {
    const handleEvents = () => setActiveTooltipId(null);
    const handleKeydown = (e) => {
      if (e.key === 'Escape') setActiveTooltipId(null);
    };

    window.addEventListener('hashchange', handleEvents);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('hashchange', handleEvents);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  const value = useMemo(() => ({ activeTooltipId, setActiveTooltipId }), [activeTooltipId])

  return (
    <TooltipContext.Provider value={value}>
      <TooltipPrimitive.Provider {...props}>
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

  const trigger = React.useMemo(() => {
    try {
      const isSingleElement = React.Children.count(children) === 1 && React.isValidElement(children);
      // Radix asChild/Slot doesn't play well with Fragments, even if they have a single child
      const isFragment = isSingleElement && children.type === React.Fragment;
      // Functional components or class components without forwardRef will fail to slot correctly.
      // We check if it's a DOM element (string type) to be safe, while allowing memo/forwardRef if we can detect them.
      const isDOMElement = typeof children.type === 'string';

      if (isSingleElement && !isFragment && isDOMElement) {
        return children;
      }
    } catch (err) {
      console.warn('[Tooltip] Trigger validation failed, falling back to span wrapper', err);
    }
    return <span className="inline-flex">{children}</span>;
  }, [children]);

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
          if (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 768px)').matches) {
            e.stopPropagation();
            setOpen(!open);
          }
        }}
      >
        {trigger}
      </TooltipPrimitive.Trigger>
      <TooltipContent side={side} align={align} className={className}>
        {content}
        <TooltipPrimitive.Arrow className="fill-border/50" />
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
};
Tooltip.displayName = 'Tooltip';

export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = React.forwardRef(({ className, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <div>
      {/* Context-aware backdrop: only active when a tooltip is open, non-blocking */}
      <div className="fixed inset-0 z-[10015] pointer-events-none bg-black/5 animate-in fade-in duration-300" />
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={10}
        className={cn(
          "z-[10020] max-w-[calc(100vw-20px)] overflow-hidden break-words rounded-md bg-surface px-3 py-1.5 text-xs text-text border border-accent/20 shadow-[0_0_20px_rgba(0,0,0,0.3)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </div>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName
