const WebSocket = require('ws');

// Test with path-based URL which is often more reliable for raw aggregate data
const url = 'wss://fstream.binance.com/ws/!miniTicker@arr';
const ws = new WebSocket(url);

console.log(`Connecting to ${url}...`);

let messageCount = 0;

ws.on('open', () => {
    console.log('Handshake successful. Waiting for first data message...');
});

ws.on('message', (data) => {
    messageCount++;
    const raw = data.toString();
    console.log(`\n--- MESSAGE #${messageCount} RECEIVED ---`);
    console.log(`Length: ${raw.length} bytes`);
    console.log(`Snippet: ${raw.substring(0, 200)}...`);
    
    try {
        const parsed = JSON.parse(raw);
        console.log(`Format: ${Array.isArray(parsed) ? 'RAW ARRAY' : 'WRAPPED OBJECT'}`);
        if (Array.isArray(parsed)) {
            console.log(`Count: ${parsed.length} tickers found`);
        }
    } catch (e) {
        console.error('JSON Parse Error:', e.message);
    }

    if (messageCount >= 1) {
        console.log('\nData verified! Closing connection.');
        ws.close();
        process.exit(0);
    }
});

ws.on('error', (err) => {
    console.error('Connection failed:', err.message);
    process.exit(1);
});

// Timeout after 15s if no data
setTimeout(() => {
    console.error('\nTIMEOUT: Connected but received NO data after 15s.');
    ws.close();
    process.exit(1);
}, 15000);
