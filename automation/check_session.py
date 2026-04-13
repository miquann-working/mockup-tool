"""
check_session.py — Check if a Gemini session cookie is still valid.

Environment variables:
  COOKIE_DIR — path to persistent browser context cookies

Exit code 0 = session valid, prints "ok"
Exit code 1 = session expired or error, prints error message
"""

import os
import sys

COOKIE_DIR = os.environ.get("COOKIE_DIR", "")


def main():
    if not COOKIE_DIR or not os.path.isdir(COOKIE_DIR):
        print("cookie_dir_missing")
        sys.exit(1)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright_not_installed")
        sys.exit(1)

    HEADLESS = os.environ.get("HEADLESS", "0") == "1"

    with sync_playwright() as p:
        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-gpu",
            "--window-position=-2400,-2400",
        ]
        if HEADLESS:
            launch_args.append("--headless=new")

        browser = p.chromium.launch_persistent_context(
            user_data_dir=COOKIE_DIR,
            headless=False,
            args=launch_args,
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )

        browser.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            if (!window.chrome) {
                window.chrome = { runtime: {}, csi: function(){}, loadTimes: function(){} };
            }
        """)

        page = browser.pages[0]
        for extra in browser.pages[1:]:
            extra.close()
        # Minimize browser window
        try:
            cdp = browser.new_cdp_session(page)
            win = cdp.send("Browser.getWindowForTarget")
            cdp.send("Browser.setWindowBounds", {
                "windowId": win["windowId"],
                "bounds": {"windowState": "minimized"}
            })
        except Exception:
            pass

        try:
            page.goto("https://gemini.google.com/", timeout=30000)
            page.wait_for_load_state("load", timeout=15000)

            # Check if we're on a login page (session expired) or on Gemini
            url = page.url
            if "accounts.google.com" in url or "signin" in url:
                print("session_expired")
                browser.close()
                sys.exit(1)

            # Check for Gemini UI elements — try multiple selectors
            selectors = [
                '.ql-editor[contenteditable="true"]',
                '[contenteditable="true"][aria-label*="Hỏi"]',
                '[contenteditable="true"][aria-label*="prompt"]',
                '[contenteditable="true"][aria-label*="Nhập"]',
                'div[contenteditable="true"]',
                'textarea',
                'response-element',
                '[data-test-id="chat-input"]',
            ]
            found = False
            for sel in selectors:
                try:
                    el = page.wait_for_selector(sel, timeout=3000)
                    if el:
                        found = True
                        break
                except Exception:
                    continue

            if not found:
                # Last resort: if URL is gemini.google.com (not redirected), session is likely valid
                if "gemini.google.com" in page.url and "accounts.google.com" not in page.url:
                    found = True

            if found:
                print("ok")
                browser.close()
                sys.exit(0)
            else:
                print("session_unknown")
                browser.close()
                sys.exit(1)

        except Exception as e:
            print(f"error: {str(e)[:200]}")
            browser.close()
            sys.exit(1)


if __name__ == "__main__":
    main()
