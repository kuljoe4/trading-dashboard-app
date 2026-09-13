from playwright.sync_api import sync_playwright
import os

def run_cuj(page):
    page.goto("http://localhost:5173")
    page.wait_for_timeout(1000)

    # Click on Config / Edit button or Settings tab
    # Open Config modal if available or inspect risk settings section
    if page.get_by_label("Edit strategy configuration").is_visible():
        page.get_by_label("Edit strategy configuration").click()
        page.wait_for_timeout(500)

        # Open Risk section accordion
        if page.get_by_text("Risk Management").is_visible():
            page.get_by_text("Risk Management").click()
            page.wait_for_timeout(500)

    page.screenshot(path="/home/jules/verification/screenshots/verification.png")
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
            print(f"Playwright run note: {e}")
        finally:
            context.close()
            browser.close()
