# Binance API Keys Testing Guide

## Quick Start: Validate API Keys Before Saving

Your dashboard now includes a **Test API Keys** button that will validate your Binance credentials before you apply them.

### Steps:

1. **Go to Settings** → Exchange Integration section
2. **Enter your API Keys:**
   - Live: Paste your Binance Futures API Key
   - Testnet: Paste your Binance Testnet API Key
3. **Click "Test API Keys"** button (shows as "Validating..." while testing)
4. **Review Results:**
   - ✅ **Green checkmark** = Key is valid and can access Binance
   - ❌ **Red alert** = Key is invalid or has permission issues
5. **Fix Issues** (see below for common errors)
6. **Click "Apply All Credentials"** to save

---

## Common Validation Errors

### Error: "Invalid API-key, IP, or permissions for action."
**Causes:**
- API key is malformed or incorrect
- Key has been deleted/regenerated from Binance
- IP address is blocked
- API key doesn't have required permissions

**Fix:**
1. Go to [Binance API Management](https://www.binance.com/en/account/api-management)
2. Verify the API key exists and is enabled
3. Copy the key again (make sure there's no extra whitespace)
4. Check that "Futures" permissions are enabled
5. If you set IP whitelist, add your current IP: https://www.ipify.org/

### Error: "Signature for this request invalid."
**Causes:**
- API Secret is incorrect
- Key/Secret mismatch

**Fix:**
- Verify you're using the API **Key** (not the label/name)
- Verify you're using the correct **Secret**
- Both must come from the same API key pair

### Error: "Network error" or "Failed to reach Binance"
**Causes:**
- Connection issue
- Firewall/proxy blocking
- Binance API temporarily down

**Fix:**
1. Check your internet connection
2. Try again in a few moments
3. Visit [Binance Status](https://www.binance.com/en/feed/post/41) to check API health

---

## Manual Testing with curl

If you want to test directly without the dashboard, use these commands in your terminal:

### Test Live API Key:
```bash
curl "https://fapi.binance.com/fapi/v1/account" \
  -H "X-MBX-APIKEY: YOUR_LIVE_API_KEY_HERE"
```

### Test Testnet API Key:
```bash
curl "https://testnet.binancefuture.com/fapi/v1/account" \
  -H "X-MBX-APIKEY: YOUR_TESTNET_API_KEY_HERE"
```

**Success Response:**
```json
{
  "feeTier": 2,
  "canTrade": true,
  "balances": [
    {
      "asset": "USDT",
      "walletBalance": "10000.00000000",
      "unrealizedProfit": "0.00000000"
    }
  ]
}
```

**Error Response:**
```json
{
  "code": -2015,
  "msg": "Invalid API-key, IP, or permissions for action."
}
```

---

## Check Backend Logs

If validation still fails, check the backend logs for detailed error messages:

1. Look at the terminal where your backend is running (the "node" terminal)
2. You should see detailed error logs from the validation attempt
3. Share the error output if you need debugging help

---

## Security Best Practices

✅ **DO:**
- Use **separate API keys** for live and testnet
- **Disable "Withdrawals"** in API permissions
- **Set IP whitelist** to your current address if available
- Use **HTTPS only** when entering credentials
- **Regenerate keys** if you ever share them accidentally

❌ **DON'T:**
- Use the same key for multiple applications
- Share your API Secret with anyone
- Use HTTP connections on public WiFi
- Leave "Withdrawals" enabled (unless specifically needed)

---

## Troubleshooting

**Question:** Why does the test show "valid" but orders still fail?
- Check if your key has trading enabled in permissions
- Verify you have sufficient balance
- Check Binance rate limits (use /session/binance/rate-limit endpoint)

**Question:** Can I test without API Secret?
- Currently the test only validates API Key. Secret is not tested to avoid accidental exposure
- Backend automatically validates Secret format when saving

**Question:** Where are my credentials stored?
- Encrypted in the database backend
- Never sent to frontend after initial submission
- Only decrypted when needed for trading operations

---

## Still Having Issues?

1. Check the backend logs (terminal output)
2. Try the curl commands manually to isolate the problem
3. Verify your keys at: https://www.binance.com/en/account/api-management
4. Check Binance system status
