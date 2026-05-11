const WebSocket = require('ws');

const url = 'wss://stream.binance.com:9443/ws/btcusdt@ticker';
const ws = new WebSocket(url);

console.log(`Connecting to ${url}...`);

ws.on('open', () => {
    console.log('Connected!');
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg);
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
