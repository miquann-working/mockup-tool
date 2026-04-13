"""
export_cookies.py — Export cookies from existing Chromium profile to JSON.
Run on Windows where cookies are already logged in.

Usage:
  python automation/export_cookies.py <email>
  python automation/export_cookies.py --all
"""
import os
import sys
import json
import glob


def export_one(email):
    cookie_dir = os.path.join(os.path.dirname(__file__), "..", "cookies", email)
    if not os.path.isdir(cookie_dir):
        print(f"  SKIP {email}: directory not found")
        return False

    json_path = os.path.join(cookie_dir, "exported_cookies.json")
    if os.path.isfile(json_path):
        print(f"  SKIP {email}: exported_cookies.json already exists")
        return True

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: pip install playwright")
        sys.exit(1)

    print(f"  Exporting {email}...")

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=cookie_dir,
            headless=True,
            channel="chrome",
            ignore_default_args=["--enable-automation"],
            args=[
                "--disable-blink-features=AutomationControlled",
                "--password-store=basic",
                "--disable-gpu",
                "--no-sandbox",
            ],
        )
        try:
            cookies = browser.cookies()
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(cookies, f)
            print(f"  OK: {len(cookies)} cookies exported")
            return True
        except Exception as e:
            print(f"  ERROR: {e}")
            return False
        finally:
            browser.close()


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python automation/export_cookies.py <email>")
        print("  python automation/export_cookies.py --all")
        sys.exit(1)

    if sys.argv[1] == "--all":
        cookies_dir = os.path.join(os.path.dirname(__file__), "..", "cookies")
        if not os.path.isdir(cookies_dir):
            print(f"No cookies directory: {cookies_dir}")
            sys.exit(1)
        emails = [d for d in os.listdir(cookies_dir)
                  if os.path.isdir(os.path.join(cookies_dir, d)) and "@" in d]
        if not emails:
            print("No cookie folders found")
            sys.exit(1)
        print(f"Exporting {len(emails)} account(s)...")
        for email in sorted(emails):
            export_one(email)
    else:
        email = sys.argv[1]
        if not export_one(email):
            sys.exit(1)

    print("\nDone! Now upload cookies via Dashboard > Upload Cookie")


if __name__ == "__main__":
    main()
