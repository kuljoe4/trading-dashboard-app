import json

config = {
    "enabled_signals": ["ema_dual_cross"],
    "signal_params": "{\"entry_ema_fast\": \"9\", \"entry_ema_slow\": \"21\"}"
}

# Simulate the parsing logic in backend/node/src/trading/session.controller.ts
def parse_params(cfg):
    if "signal_params" in cfg and isinstance(cfg["signal_params"], str):
        try:
            cfg["signal_params"] = json.loads(cfg["signal_params"])
        except:
            pass
    return cfg

# Simulate the validation logic in backend/node/src/trading/session.service.ts
def validate(config):
    signalParams = config.get("signal_params", {})
    allEnabled = config.get("enabled_signals", [])
    
    if "ema_dual_cross" in allEnabled:
        fast = int(signalParams.get("entry_ema_fast", 0))
        slow = int(signalParams.get("entry_ema_slow", 0))
        print(f"Fast: {fast}, Slow: {slow}")
        if fast <= 0 or slow <= 0:
            return "EMA Dual Cross requires both fast and slow periods"
        if fast >= slow:
            return "EMA Dual Cross: Fast period must be less than slow period"
    return "OK"

parsed = parse_params(config)
print(validate(parsed))
