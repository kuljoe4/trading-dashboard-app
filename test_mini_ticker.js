const WebSocket = require('ws');

const url = 'wss://fstream.binance.com/stream?streams=!miniTicker@arr';
const ws = new WebSocket(url);

console.log(`Connecting to ${url}...`);

ws.on('open', () => {
    console.log('Connected!');
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const tickers = msg.data || msg;
    console.log(`Received ${Array.isArray(tickers) ? tickers.length : 'object'} tickers`);
    if (msg.length > 0) {
        console.log('Sample ticker:', msg[0]);
    }
    ws.close();
    process.exit(0);
});

ws.on('error', (err) => {
    console.error('WS Error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.log('Timeout waiting for message');
    process.exit(1);
}, 10000);
