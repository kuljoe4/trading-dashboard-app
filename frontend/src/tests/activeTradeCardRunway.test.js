import test from 'node:test'
import assert from 'node:assert/strict'

// Extract R-multiple runway calculation logic for direct unit testing
function computeRunwayPositions(trade) {
  const entry = Number(trade.entry_price || 0)
  const mark = Number(trade.mark_price || trade.last_price || 0)
  const sl = Number(trade.sl_price || 0)
  const tp = Number(trade.tp_price || 0)
  const isLong = trade.direction === 'LONG'

  const initialSl = Number(trade.initial_sl || sl || 0)
  const rawRiskUnit = Math.abs(entry - initialSl)
  const riskUnit = rawRiskUnit > 0 ? rawRiskUnit : (entry > 0 ? entry * 0.01 : 1)

  const getR = (price) => {
    if (!price || !isFinite(price) || !entry) return 0
    return isLong ? (price - entry) / riskUnit : (entry - price) / riskUnit
  }

  const targetPrice = tp > 0 ? tp : (isLong ? entry + riskUnit * 3 : entry - riskUnit * 3)
  const targetR = Math.max(0.5, getR(targetPrice))
  const maxRr = Number(trade.max_rr ?? trade.max_rr_achieved ?? trade.rr ?? 0)
  const peakR = Math.max(0, maxRr)
  const slR = getR(sl)
  const markR = getR(mark)

  const bufferR = Math.max(0.3, targetR * 0.15)
  const rightEdgeR = Math.max(targetR, peakR) + bufferR
  const leftEdgeR = Math.min(-1, slR, markR < -1 ? markR : -1)
  const totalRangeR = rightEdgeR - leftEdgeR

  const pos = (price) => {
    if (!totalRangeR || totalRangeR <= 0) return 50
    const r = getR(price)
    const frac = (r - leftEdgeR) / totalRangeR
    return Math.max(0, Math.min(100, frac * 100))
  }

  const progress = pos(mark)
  const entryMarkPos = pos(entry)
  const slPos = pos(sl)
  const tpPos = pos(targetPrice)
  const peakPrice = isLong ? (entry + peakR * riskUnit) : (entry - peakR * riskUnit)
  const peakPos = pos(peakPrice)

  return {
    riskUnit,
    targetR,
    rightEdgeR,
    leftEdgeR,
    progress,
    entryMarkPos,
    slPos,
    tpPos,
    peakPos,
    getR
  }
}

test('R-multiple Price Runway: LONG position initial state', () => {
  const trade = {
    direction: 'LONG',
    entry_price: 100,
    initial_sl: 95,
    sl_price: 95,
    tp_price: 115,
    mark_price: 100,
    max_rr: 0
  }

  const res = computeRunwayPositions(trade)
  assert.equal(res.riskUnit, 5)
  assert.equal(res.targetR, 3)
  assert.equal(res.leftEdgeR, -1)
  assert.ok(res.rightEdgeR > 3)

  // Entry at R=0 must sit to the right of Initial SL at R=-1
  assert.ok(res.entryMarkPos > res.slPos)
  // TP at R=3 must sit to the right of Entry
  assert.ok(res.tpPos > res.entryMarkPos)
  // Live mark at entry should equal entryMarkPos
  assert.equal(res.progress, res.entryMarkPos)
})

test('R-multiple Price Runway: Trailing SL past entry (Breakeven or better) does NOT invert entry and mark', () => {
  // LONG, entry=100, initial SL=95, TP=115. SL trailed up to 105 (+1R). Mark pulls back to 107 (+1.4R).
  const trade = {
    direction: 'LONG',
    entry_price: 100,
    initial_sl: 95,
    sl_price: 105,
    tp_price: 115,
    mark_price: 107,
    max_rr: 2.0
  }

  const res = computeRunwayPositions(trade)

  // Entry at R=0
  // Current SL at R=+1
  // Mark at R=+1.4
  // Order on bar MUST be: entryMarkPos < slPos < progress < tpPos
  assert.ok(res.entryMarkPos < res.slPos, 'Entry dot (R=0) sits to the left of trailing SL (R=+1)')
  assert.ok(res.slPos < res.progress, 'Trailing SL dot (R=+1) sits to the left of live mark (R=+1.4)')
  assert.ok(res.progress < res.tpPos, 'Live mark dot sits to the left of TP (R=+3)')
})

test('R-multiple Price Runway: SHORT position trailing SL past entry', () => {
  // SHORT, entry=100, initial SL=105, TP=85. SL trailed to 95 (+1R). Mark at 93 (+1.4R).
  const trade = {
    direction: 'SHORT',
    entry_price: 100,
    initial_sl: 105,
    sl_price: 95,
    tp_price: 85,
    mark_price: 93,
    max_rr: 2.0
  }

  const res = computeRunwayPositions(trade)

  // Entry at R=0
  // Current SL at R=+1 (price 95 is +1R profitable for SHORT)
  // Mark at R=+1.4 (price 93 is +1.4R profitable for SHORT)
  assert.ok(res.entryMarkPos < res.slPos, 'Entry dot sits to the left of trailing SL for SHORT')
  assert.ok(res.slPos < res.progress, 'Trailing SL sits to the left of live mark for SHORT')
  assert.ok(res.progress < res.tpPos, 'Live mark sits to the left of TP for SHORT')
})

test('R-multiple Price Runway: Peak extension dynamically scales right edge', () => {
  const trade = {
    direction: 'LONG',
    entry_price: 100,
    initial_sl: 95,
    sl_price: 105,
    tp_price: 115, // targetR = 3
    mark_price: 125, // 5R
    max_rr: 6.0 // peakR = 6
  }

  const res = computeRunwayPositions(trade)
  // rightEdgeR should be at least 6 + buffer
  assert.ok(res.rightEdgeR >= 6.3)
  // Peak position sits inside scale
  assert.ok(res.peakPos <= 100)
  assert.ok(res.peakPos > res.tpPos)
})
