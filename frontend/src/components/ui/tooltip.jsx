import React, { createContext, useContext, useState, useMemo } from 'react'
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "./primitives"

const TooltipContext = createContext({
  activeTooltipId: null,
  setActiveTooltipId: () => {}
})

export const useTooltipContext = () => useContext(TooltipContext)

export const TooltipProvider = ({ children, ...props }) => {
  const [activeTooltipId, setActiveTooltipId] = useState(null)
  const value = useMemo(() => ({ activeTooltipId, setActiveTooltipId }), [activeTooltipId])

  return (
    <TooltipContext.Provider value={value}>
      <TooltipPrimitive.Provider {...props}>
        <div
          className={cn(
            "fixed inset-0 z-[90] bg-background/40 backdrop-blur-[2px] transition-all duration-300 pointer-events-none",
            activeTooltipId ? "opacity-100" : "opacity-0"
          )}
          aria-hidden="true"
        />
        {children}
      </TooltipPrimitive.Provider>
    </TooltipContext.Provider>
  )
}

export const Tooltip = ({ onOpenChange, ...props }) => {
  const id = React.useId()
  const { setActiveTooltipId } = useTooltipContext()

  return (
    <TooltipPrimitive.Root
      onOpenChange={(open) => {
        if (open) setActiveTooltipId(id)
        else setActiveTooltipId(null)
        onOpenChange?.(open)
      }}
      {...props}
    />
  )
}
export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = React.forwardRef(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-[100] overflow-hidden rounded-md bg-surface px-3 py-1.5 text-xs text-text border border-accent/20 shadow-[0_0_20px_rgba(0,0,0,0.3)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName
