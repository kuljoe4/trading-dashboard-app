function originalFilter(results, search, rangeFilter, discoveryMode, sortBy, proxMap) {
  if (search) {
      const term = search.toLowerCase().trim()
      results = results.filter(r => r.symbol.toLowerCase().includes(term))
    }

    if (rangeFilter === 'usdt') {
      results = results.filter(r => (r.symbol || '').toUpperCase().endsWith('USDT'))
    } else if (rangeFilter === 'non_usdt') {
      results = results.filter(r => !(r.symbol || '').toUpperCase().endsWith('USDT'))
    } else if (rangeFilter === 'pos') {
      results = results.filter(r => (r.pct || 0) > 0)
    } else if (rangeFilter === 'neg') {
      results = results.filter(r => (r.pct || 0) < 0)
    } else if (rangeFilter === 'movers') {
      results = results.filter(r => Math.abs(r.pct || 0) >= 2.0)
    } else if (rangeFilter === 'extreme') {
      results = results.filter(r => Math.abs(r.pct || 0) >= 5.0)
    }

    if (discoveryMode === 'volume') {
      results = results
        .sort((a, b) => (a.volume_rank || 999) - (b.volume_rank || 999))
        .slice(0, 24);
    } else if (discoveryMode === 'pct_change') {
      results = results
        .sort((a, b) => (a.change_rank || 999) - (b.change_rank || 999))
        .slice(0, 24);
    }

    if (sortBy === 'proximity') {
      results = [...results].sort((a, b) => proxMap.get(b.symbol) - proxMap.get(a.symbol));
    } else if (sortBy === 'score') {
      results = [...results].sort((a, b) => (b.score || 0) - (a.score || 0))
    } else if (sortBy === 'pct_desc') {
      results = [...results].sort((a, b) => (b.pct || 0) - (a.pct || 0))
    } else if (sortBy === 'pct_asc') {
      results = [...results].sort((a, b) => (a.pct || 0) - (b.pct || 0))
    } else if (sortBy === 'vol_desc') {
      results = [...results].sort((a, b) => (b.vol || b.volume || 0) - (a.vol || a.volume || 0))
    }
  return results;
}

function optimizedFilter(results, search, rangeFilter, discoveryMode, sortBy, proxMap) {
  const term = search ? search.toLowerCase().trim() : '';

  const filtered = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];

    if (term && !r.symbol.toLowerCase().includes(term)) continue;

    if (rangeFilter === 'usdt' && !(r.symbol || '').toUpperCase().endsWith('USDT')) continue;
    if (rangeFilter === 'non_usdt' && (r.symbol || '').toUpperCase().endsWith('USDT')) continue;
    if (rangeFilter === 'pos' && (r.pct || 0) <= 0) continue;
    if (rangeFilter === 'neg' && (r.pct || 0) >= 0) continue;
    if (rangeFilter === 'movers' && Math.abs(r.pct || 0) < 2.0) continue;
    if (rangeFilter === 'extreme' && Math.abs(r.pct || 0) < 5.0) continue;

    filtered.push(r);
  }

  let finalResults = filtered;
  if (discoveryMode === 'volume') {
    finalResults.sort((a, b) => (a.volume_rank || 999) - (b.volume_rank || 999));
    finalResults = finalResults.slice(0, 24);
  } else if (discoveryMode === 'pct_change') {
    finalResults.sort((a, b) => (a.change_rank || 999) - (b.change_rank || 999));
    finalResults = finalResults.slice(0, 24);
  } else {
    if (sortBy === 'proximity') {
        finalResults.sort((a, b) => proxMap.get(b.symbol) - proxMap.get(a.symbol));
    } else if (sortBy === 'score') {
        finalResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sortBy === 'pct_desc') {
        finalResults.sort((a, b) => (b.pct || 0) - (a.pct || 0));
    } else if (sortBy === 'pct_asc') {
        finalResults.sort((a, b) => (a.pct || 0) - (b.pct || 0));
    } else if (sortBy === 'vol_desc') {
        finalResults.sort((a, b) => (b.vol || b.volume || 0) - (a.vol || a.volume || 0));
    }
  }

  return finalResults;
}

const mockResults = Array.from({length: 1000}, (_, i) => ({
  symbol: `SYM${i}USDT`,
  pct: (Math.random() - 0.5) * 10,
  score: Math.random() * 100,
  volume_rank: Math.floor(Math.random() * 1000),
  change_rank: Math.floor(Math.random() * 1000),
  vol: Math.random() * 1000000
}));

const mockProxMap = new Map();
mockResults.forEach(r => mockProxMap.set(r.symbol, Math.random() * 100));

console.time('original');
for(let i=0; i<1000; i++) {
  originalFilter([...mockResults], 'sym', 'pos', 'volume', 'score', mockProxMap);
}
console.timeEnd('original');

console.time('optimized');
for(let i=0; i<1000; i++) {
  optimizedFilter([...mockResults], 'sym', 'pos', 'volume', 'score', mockProxMap);
}
console.timeEnd('optimized');
