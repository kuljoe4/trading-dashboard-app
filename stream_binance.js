
const BACKEND_URL = 'http://localhost:3000/session/debug/inject';
const BINANCE_REST_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
const INTERVAL_MS = 2000;

console.log('Starting Binance REST Streamer...');
console.log(`Polling ${BINANCE_REST_URL} every ${INTERVAL_MS}ms`);
console.log(`Injecting into ${BACKEND_URL}`);

async function pulse() {
    try {
        const response = await fetch(BINANCE_REST_URL);
        if (!response.ok) {
            console.error('Binance REST error:', response.statusText);
            return;
        }

        const tickers = await response.json();
        const usdtTickers = tickers
            .filter(t => t.symbol.endsWith('USDT'))
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 100);

        const injectResponse = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickers: usdtTickers })
        });

        if (injectResponse.ok) {
            console.log(`[${new Date().toLocaleTimeString()}] Successfully injected ${usdtTickers.length} tickers`);
        } else {
            console.error('Backend inject error:', await injectResponse.text());
        }
    } catch (error) {
        console.error('Pulse error:', error.message);
    }
}

setInterval(pulse, INTERVAL_MS);
pulse();
