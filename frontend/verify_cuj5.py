from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.route("**/*.{woff,woff2}", lambda route: route.abort())
    # The frontend client makes requests to http://localhost:3000/api/... usually, or whatever is in .env
    def mock_backend(route):
        url = route.request.url
        print(f"Mocking backend {url}")
        if "auth/verify" in url:
            route.fulfill(status=200, json={"user":{"id":1}})
        elif "health" in url:
            route.fulfill(status=200, json={"status":"ok"})
        elif "config/presets" in url:
            route.fulfill(status=200, json=[])
        else:
            route.fulfill(status=200, json={})

    page.route("http://localhost:3000/api/**", mock_backend)

    # Let the dev server fully load
    page.goto("http://localhost:5173")
    page.wait_for_timeout(5000)

    html = page.content()
    print("Page HTML loaded. Length:", len(html))
    if "SYNCHRONIZING..." in html:
        print("Page is stuck in SYNCHRONIZING state")

    try:
        # Check if Start Session exists
        page.get_by_role("button", name="Start Session").first.click(timeout=3000)
        page.wait_for_timeout(1000)
        page.get_by_text("Capital Guards").click(timeout=3000)
        page.wait_for_timeout(500)

        # Toggle Martingale
        page.get_by_role("switch", name="Enable Martingale Risk").click(timeout=1000)
        page.wait_for_timeout(500)

        # Take screenshot
        page.screenshot(path="/home/jules/verification/screenshots/verification.png")
    except Exception as e:
        print("UI interaction failed:", e)
        page.screenshot(path="/home/jules/verification/screenshots/verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir="/home/jules/verification/videos")
        page = context.new_page()
        try:
            run_cuj(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            context.close()
            browser.close()
