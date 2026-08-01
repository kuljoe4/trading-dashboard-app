import os
import json
import re
from playwright.sync_api import sync_playwright

def verify_frontend():
    print("Starting Playwright browser with resilient time delays...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()

        # Abort remote font requests to completely prevent Page.screenshot timeouts
        page.route(re.compile(r".*\.(woff|woff2|ttf|eot).*"), lambda r: r.abort())
        page.route(re.compile(r".*fonts\.(googleapis|gstatic)\.com.*"), lambda r: r.abort())

        # Mock Auth Config
        print("Registering /auth/config mock...")
        page.route(re.compile(r".*/auth/config.*"), lambda route: route.fulfill(
            status=200,
            headers={"Access-Control-Allow-Origin": "*"},
            content_type="application/json",
            body=json.dumps({"adminApiKey": "mock-admin-api-key"})
        ))

        # Mock Session Status with activeTrades populated!
        print("Registering /session/status mock...")
        mock_status = {
            "running": True,
            "paused": False,
            "paused_strategies": [],
            "strategy_gate_states": {},
            "strategyId": "mock-session-id",
            "paperMode": True,
            "tradingMode": "paper",
            "balance": 12500.45,
            "totalPnl": 450.25,
            "logLines": [],
            "activeTrades": [
                {
                    "id": "trade-uuid-1",
                    "symbol": "BTCUSDT",
                    "direction": "LONG",
                    "entry_price": 65000.0,
                    "current_price": 65800.0,
                    "qty": 0.15,
                    "initial_sl": 64000.0,
                    "sl_price": 64500.0,
                    "tp_price": 68000.0,
                    "pnl": 120.0,
                    "pnl_pct": 1.23,
                    "rr": 1.2,
                    "max_rr": 1.5,
                    "status": "OPEN",
                    "live_rr_sequence": [1, 2, 3],
                    "exit_rr_sequence": [0, 1, 2],
                    "strategy_label": "Momentum Strategy",
                    "est_pnl_to_realize": 450.0,
                    "tp_mode": "fixed",
                    "exit_signals_status": {
                        "ema_close": { "label": "EMA Close", "progress": 45, "threshold": 64600.0, "fired": False, "active": True },
                        "macd_fade": { "label": "MACD Fade", "progress": 80, "threshold": 64800.0, "fired": False, "active": True }
                    }
                }
            ],
            "scannerResults": [],
            "activeWindows": [],
            "gateState": None,
            "scannerPaused": False,
            "totalRiskPct": 1.5,
            "totalSlUsed": 150.0,
            "apiStatus": { "isBanned": False, "isRateLimited": False },
            "config": {
                "paper_mode": True,
                "strategy_label": "Momentum Strategy",
                "scan_interval": "5m",
                "trading_mode": "paper"
            },
            "startTime": "2026-06-25T12:00:00.000Z"
        }
        page.route(re.compile(r".*/session/status.*"), lambda route: route.fulfill(
            status=200,
            headers={"Access-Control-Allow-Origin": "*"},
            content_type="application/json",
            body=json.dumps(mock_status)
        ))

        # Mock History and Analytics
        page.route(re.compile(r".*/session/history.*"), lambda route: route.fulfill(
            status=200,
            headers={"Access-Control-Allow-Origin": "*"},
            content_type="application/json",
            body=json.dumps({"trades": []})
        ))
        page.route(re.compile(r".*/session/analytics.*"), lambda route: route.fulfill(
            status=200,
            headers={"Access-Control-Allow-Origin": "*"},
            content_type="application/json",
            body=json.dumps({})
        ))

        # Navigate to active trades page
        print("Navigating to Trades view...")
        page.goto("http://localhost:5173/#/trades", wait_until="load", timeout=15000)

        # Wait precisely 6 seconds for React router and data fetch to fully resolve and hydrate
        print("Waiting 6 seconds for UI stabilization...")
        page.wait_for_timeout(6000)

        # Non-blocking add of style tag to bypass external web fonts wait
        try:
            page.add_style_tag(content="* { font-family: system-ui, -apple-system, sans-serif !important; }")
            page.wait_for_timeout(500)
        except Exception as e:
            print(f"Skipping style tag due to: {e}")

        # Save screenshot of the main Trades page (demonstrating responsive Active P&L card and 4-column layout)
        os.makedirs("./verification", exist_ok=True)
        screenshot_path = "./verification/trades_responsive_grid.png"
        page.screenshot(path=screenshot_path)
        print(f"Saved screenshot of responsive trades grid to {screenshot_path}")

        # Click on the active trade card to open the detail modal
        print("Opening active trade detail modal by clicking BTCUSDT...")
        page.click("text=BTCUSDT")
        page.wait_for_timeout(2000)  # Wait for modal open animation

        # Click on the "Edit Config" toggle button inside the modal to expand the modernized workspace
        print("Toggling active exit guard configuration workspace...")
        page.click("text=Edit Config")
        page.wait_for_timeout(2000)  # Wait for workspace collapse animation

        # Take screenshot of the modernized workspace in the modal
        final_screenshot_path = "./verification/verification.png"
        page.screenshot(path=final_screenshot_path)
        print(f"Final visual verification screenshot saved to {final_screenshot_path}")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
