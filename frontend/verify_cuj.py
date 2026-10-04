from playwright.sync_api import sync_playwright

def run_cuj(page):
    # Block woff fonts as per memory instructions to prevent timeouts
    page.route("**/*.{woff,woff2}", lambda route: route.abort())

    # Navigate to the frontend dev server
    page.goto("http://localhost:5173")
    page.wait_for_timeout(2000)

    # Let's open the config modal directly or start a session
    try:
        # Check if Start Session exists
        page.get_by_role("button", name="Start Session").first.click(timeout=5000)
    except:
        # Maybe on a different page, just click settings
        try:
            page.locator("button[aria-label='Settings']").click(timeout=5000)
        except:
            print("Couldn't find start session or settings button")

    page.wait_for_timeout(1000)

    try:
        # Click the Capital Guards tab inside the ConfigModal
        page.get_by_text("Capital Guards").click(timeout=5000)
    except:
        pass

    page.wait_for_timeout(1000)

    # Take screenshot at the key moment showing the filled out Martingale settings
    page.screenshot(path="/home/jules/verification/screenshots/verification.png", timeout=5000)
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        except Exception as e:
            print(f"Error during CUJ: {e}")
            try:
                page.screenshot(path="/home/jules/verification/screenshots/error.png", timeout=5000)
            except:
                pass
        finally:
            context.close()  # MUST close context to save the video
            browser.close()
