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

        try:
            # Hide webdriver property
            browser.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            """)

            page = browser.pages[0] if browser.pages else browser.new_page()
            for extra in browser.pages[1:]:
                extra.close()

            # Warm up: visit Google first to establish cookies before Gemini
            print("[setup] Navigating to google.com...", flush=True)
            try:
                page.goto("https://www.google.com/", wait_until="domcontentloaded", timeout=15000)
            except Exception as e:
                print(f"[setup] google.com nav warning: {e}", flush=True)
            time.sleep(2)

            print("[setup] Navigating to accounts.google.com...", flush=True)
            try:
                page.goto("https://accounts.google.com/", wait_until="domcontentloaded", timeout=15000)
            except Exception as e:
                print(f"[setup] accounts.google.com nav warning: {e}", flush=True)
            time.sleep(2)

            print("[setup] Navigating to gemini.google.com...", flush=True)
            try:
                page.goto("https://gemini.google.com/", wait_until="domcontentloaded", timeout=30000)
            except Exception as e:
                print(f"[setup] gemini.google.com nav warning: {e}", flush=True)

            # Auto-detect: poll until we land on gemini.google.com/app (logged in)
            max_wait = 300  # 5 minutes
            start = time.time()
            logged_in = False

            def _check_logged_in():
                """Check all pages in context for gemini.google.com/app"""
                for pg in browser.pages:
                    try:
                        u = pg.url
                        if ("gemini.google.com/app" in u or "gemini.google.com/gem" in u) \
                                and "accounts.google.com" not in u and "signin" not in u:
                            return True, u
                    except Exception:
                        pass
                return False, None

            print(f"[setup] Polling for login (page.url={page.url}, pages={len(browser.pages)})...", flush=True)
            while time.time() - start < max_wait:
                found, found_url = _check_logged_in()
                if found:
                    print(f"[setup] Detected logged in: {found_url}", flush=True)
                    time.sleep(2)
                    logged_in = True
                    break
                elapsed = int(time.time() - start)
                if elapsed % 10 == 0 and elapsed > 0:
                    urls = [pg.url for pg in browser.pages]
                    print(f"[setup] Still polling ({elapsed}s)... urls={urls}", flush=True)
                time.sleep(1)

            if not logged_in:
                print("\n[setup] Timeout (5 min). Closing browser...", flush=True)
                return None

            print(f"[setup] Login successful!", flush=True)

            # Export cookies as plaintext JSON for cross-platform portability
            try:
                cookies = browser.cookies()
                cookies_json_path = os.path.join(cookie_dir, "exported_cookies.json")
                with open(cookies_json_path, "w", encoding="utf-8") as f:
                    json.dump(cookies, f)
                print(f"[setup] Exported {len(cookies)} cookies to exported_cookies.json", flush=True)
            except Exception as e:
                print(f"[setup] Warning: could not export cookies JSON: {e}", flush=True)

            # Save platform marker so agents know if cross-platform clearing is needed
            import platform as _platform
            try:
                with open(os.path.join(cookie_dir, "cookie_platform.txt"), "w") as f:
                    f.write(_platform.system())
                print(f"[setup] Platform marker: {_platform.system()}", flush=True)
            except Exception:
                pass

        finally:
            print("[setup] Closing browser...", flush=True)
            try:
                browser.close()
            except Exception:
                pass
            print("[setup] Browser closed.", flush=True)

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
