const WebSocket = require('ws');

const url = 'wss://fstream.binance.com/ws';
const ws = new WebSocket(url);

console.log(`Connecting to ${url}...`);

ws.on('open', () => {
    console.log('Connected! Sending subscribe...');
    ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: ['btcusdt@ticker'],
        id: 1
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg);
    if (msg.result === null && msg.id === 1) {
        console.log('Subscription successful, waiting for data...');
        return;
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
}, 15000);
