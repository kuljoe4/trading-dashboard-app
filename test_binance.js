const WebSocket = require('ws');

const ws = new WebSocket('wss://fstream.binance.com/stream?streams=!miniTicker@arr');

console.log('Connecting to Binance...');

ws.on('open', () => {
    console.log('Successfully connected to Binance WebSocket!');
    ws.close();
    process.exit(0);
});

ws.on('error', (err) => {
    console.error('Connection failed:', err.message);
    process.exit(1);
});

ws.on('close', () => {
    console.log('Connection closed.');
});
