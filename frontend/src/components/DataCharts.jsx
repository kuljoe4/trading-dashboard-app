import React, { useMemo } from 'react'
import { Chart } from 'react-charts'
import { C } from '../lib/theme'

export const Sparkline = React.memo(({ data = [], width = 60, height = 24, color = "accent" }) => {
  if (!data || data.length < 2) return <div style={{ width, height }} />;

  const chartData = useMemo(() => [{
    label: 'Price',
    data: data.map((val, i) => ({ x: i, y: val }))
  }], [data])

  const primaryAxis = useMemo(() => ({
    getValue: datum => datum.x,
    show: false,
  }), [])

  const secondaryAxes = useMemo(() => [{
    getValue: datum => datum.y,
    show: false,
  }], [])

  const colorHex = color === 'green' ? '#00e5a0' : color === 'red' ? '#ff4466' : '#5b6fff'

  return (
    <div style={{ width, height }}>
      <Chart
        options={{
          data: chartData,
          primaryAxis,
          secondaryAxes,
          defaultColors: [colorHex],
          dark: true,
        }}
      />
    </div>
  )
})

export const PnLBarsChart = ({ trades }) => {
  if (!trades || trades.length === 0) return <div className="h-[120px]" />

  const chartData = useMemo(() => [{
    label: 'PnL',
    data: trades.map((t, i) => ({ x: i, y: t.pnl || 0 }))
  }], [trades])

  const primaryAxis = useMemo(() => ({
    getValue: datum => datum.x,
    show: false,
  }), [])

  const secondaryAxes = useMemo(() => [{
    getValue: datum => datum.y,
    elementType: 'bar',
  }], [])

  return (
    <div className="h-[120px] w-full">
      <Chart
        options={{
          data: chartData,
          primaryAxis,
          secondaryAxes,
          getSeriesStyle: (series) => ({
            fill: series.index === 0 ? '#5b6fff' : '#5a6a88',
          }),
          dark: true,
        }}
      />
    </div>
  )
}
