"""
setup_account.py — Interactive script to log in to Gemini and save cookies.

Usage:
  python setup_account.py <email>

This opens a browser window. You manually log in to Google/Gemini.
Once Gemini loads successfully, cookies are auto-saved and browser closes.
A zip file is also created for uploading to the server via admin panel.
"""

import os
import sys
import time
import json
import zipfile


def export_zip(cookie_dir, email):
    """Create a zip of the cookie directory for upload to server."""
    zip_path = os.path.join(os.path.dirname(cookie_dir), f"{email}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(cookie_dir):
            for f in files:
                full = os.path.join(root, f)
                arcname = os.path.relpath(full, cookie_dir)
                zf.write(full, arcname)
    return zip_path


def setup_account(email):
    """Open browser, wait for login, save cookies. Returns cookie_dir path."""
    cookie_dir = os.path.join(os.path.dirname(__file__), "..", "cookies", email)
    os.makedirs(cookie_dir, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed. Run: pip install playwright && playwright install")
        sys.exit(1)

    print(f"\n{'='*50}")
    print(f"  Login Google: {email}")
    print(f"  Cookie auto-saved when Gemini loads.")
    print(f"  Max wait: 5 minutes")
    print(f"{'='*50}\n")

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=cookie_dir,
            headless=False,
            channel="chrome",
            ignore_default_args=["--enable-automation"],
            args=[
                "--password-store=basic",
                "--disable-blink-features=AutomationControlled",
                "--window-position=100,100",
            ],
            viewport=None,
            locale="vi-VN",
            timezone_id="Asia/Ho_Chi_Minh",
        )

        # Hide webdriver property
        browser.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)

        page = browser.pages[0] if browser.pages else browser.new_page()
        for extra in browser.pages[1:]:
            extra.close()

        # Warm up: visit Google first to establish cookies before Gemini
        page.goto("https://www.google.com/", wait_until="domcontentloaded", timeout=15000)
        time.sleep(2)
        page.goto("https://accounts.google.com/", wait_until="domcontentloaded", timeout=15000)
        time.sleep(2)
        page.goto("https://gemini.google.com/", wait_until="domcontentloaded", timeout=30000)

        # Auto-detect: poll until we land on gemini.google.com/app (logged in)
        max_wait = 300  # 5 minutes
        start = time.time()
        logged_in = False

        while time.time() - start < max_wait:
            try:
                url = page.url
                if "gemini.google.com/app" in url or "gemini.google.com/gem" in url:
                    if "accounts.google.com" not in url and "signin" not in url:
                        time.sleep(2)
                        logged_in = True
                        break
            except Exception:
                pass
            time.sleep(1)

        if not logged_in:
            print("\nTimeout (5 min). Closing browser...")
            try:
                browser.close()
            except Exception:
                pass
            return None

        print(f"\nLogin successful!")

        # Export cookies as plaintext JSON for cross-platform portability
        # (Chromium encrypts cookies differently on Windows vs Linux,
        #  so we save decrypted cookies via Playwright API)
        try:
            cookies = browser.cookies()
            cookies_json_path = os.path.join(cookie_dir, "exported_cookies.json")
            with open(cookies_json_path, "w", encoding="utf-8") as f:
                json.dump(cookies, f)
            print(f"Exported {len(cookies)} cookies to exported_cookies.json")
        except Exception as e:
            print(f"Warning: could not export cookies JSON: {e}")

        # Save platform marker so agents know if cross-platform clearing is needed
        import platform as _platform
        try:
            with open(os.path.join(cookie_dir, "cookie_platform.txt"), "w") as f:
                f.write(_platform.system())
        except Exception:
            pass

        browser.close()

    return cookie_dir


def main():
    if len(sys.argv) < 2:
        print("Usage: python setup_account.py <email>")
        sys.exit(1)

    email = sys.argv[1]
    cookie_dir = setup_account(email)

    if not cookie_dir:
        sys.exit(1)

    print(f"Cookie saved: {cookie_dir}")

    # Export zip for server upload
    zip_path = export_zip(cookie_dir, email)
    print(f"\n{'='*50}")
    print(f"  ZIP: {zip_path}")
    print(f"  Upload via Admin Panel > Accounts")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
