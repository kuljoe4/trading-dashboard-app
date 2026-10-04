const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());

app.get('/api/config', (req, res) => res.json({ }));
app.get('/api/state', (req, res) => res.json({ }));
app.get('/api/auth/verify', (req, res) => res.json({ user: { id: 1 } }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/trading/config/presets', (req, res) => res.json([]));

app.listen(3000, () => console.log('Mock backend listening on port 3000'));
