from playwright.sync_api import sync_playwright
import re

def run_cuj(page):
    page.route("**/*.{woff,woff2}", lambda route: route.abort())
    # Mock only specific API endpoints to allow normal JS loading but fake backend responses
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

    # Need to regex match exact URL patterns so we don't mock frontend source files!
    page.route(re.compile(r".*/api/.*"), mock_backend)

    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(2000)

    html = page.content()
    print("Page HTML loaded. Length:", len(html))

    try:
        # Check if Start Session exists
        page.get_by_role("button", name="Start Session").first.click(timeout=3000)
    except:
        try:
            page.locator("button[aria-label='Settings']").click(timeout=3000)
        except:
            print("Couldn't find start session or settings button")

    page.wait_for_timeout(1000)

    try:
        # Click the Capital Guards tab inside the ConfigModal
        page.get_by_text("Capital Guards").click(timeout=3000)
    except:
        pass

    page.wait_for_timeout(1000)

    # Take screenshot at the key moment showing the filled out Martingale settings
    page.screenshot(path="/home/jules/verification/screenshots/verification.png")
    page.wait_for_timeout(1000)

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
