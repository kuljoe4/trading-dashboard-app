from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.route("**/*.{woff,woff2}", lambda route: route.abort())
    page.goto("http://localhost:5173")
    page.wait_for_timeout(5000)

    # Try just grabbing any text to see if page loads
    try:
        html = page.content()
        print("Page HTML loaded. Length:", len(html))
        if "SYNCHRONIZING..." in html:
             print("Found synchronizing text")
    except Exception as e:
        print("Error getting content", e)

    page.screenshot(path="/home/jules/verification/screenshots/test.png", timeout=5000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        try:
            run_cuj(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            context.close()
            browser.close()
