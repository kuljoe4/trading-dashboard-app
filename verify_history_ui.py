import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        page.on('console', lambda msg: print(f"[Browser Console {msg.type}] {msg.text}"))
        page.on('pageerror', lambda err: print(f"[Browser Uncaught Error] {err}"))

        await page.goto('http://localhost:3000/#/history', wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)

        await page.screenshot(path='/home/jules/verification/history_before.png')

        session_card = page.locator('[id^="session-"]').first
        if await session_card.count() > 0:
            print("Clicking session card to expand...")
            await session_card.click()
            await page.wait_for_timeout(500)
            await page.screenshot(path='/home/jules/verification/history_expanded.png')
            print("Expanded screenshot captured successfully.")
        else:
            print("No session card found.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
