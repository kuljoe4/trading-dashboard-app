from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.route("**/*.{woff,woff2}", lambda route: route.abort())
    # Mock all API requests so the frontend doesn't hang on backend if backend isn't perfect
    def mock_api(route):
        print(f"Mocking {route.request.url}")
        route.fulfill(status=200, json={})

    page.route("**/api/**", mock_api)

    page.goto("http://localhost:5173", wait_until="domcontentloaded")
    page.wait_for_timeout(2000)

    html = page.content()
    print("Page HTML loaded. Length:", len(html))

    page.screenshot(path="/home/jules/verification/screenshots/test3.png")

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
