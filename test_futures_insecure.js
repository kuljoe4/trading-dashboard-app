const WebSocket = require('ws');

const url = 'wss://fstream.binance.com/ws/!miniTicker@arr';
const ws = new WebSocket(url, { rejectUnauthorized: false });

console.log(`Connecting to ${url} (rejectUnauthorized: false)...`);

ws.on('open', () => {
    console.log('Connected!');
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log(`Received ${msg.length} tickers`);
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
