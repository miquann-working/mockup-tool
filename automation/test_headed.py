"""Test the new workflow in HEADED mode (visible browser)."""
import os, sys, time

# Override to headed mode
os.environ["COOKIE_DIR"] = "cookies/test@gmail.com"
# Use a real image file (not the 8-byte fake)
os.environ["IMAGE_PATH"] = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "uploads", "b9ccd91a-ffe3-4ef9-a8ab-7ef04f4b1305.avif"))
os.environ["PROMPT_TEXT"] = "Use the EXACT provided embroidered frame product image as the main subject.\nShow the rectangular frame standing upright, centered in the composition.\nBackground is a soft warm neutral wall with subtle plaster texture, slightly blurred.\nStyle: photorealistic handmade wall art photography, clean Etsy listing, minimal and elegant."
os.environ["OUTPUT_PREFIX"] = "test_headed"
os.environ["IMAGE_STYLE"] = "Chân dung dịu nhẹ"

# Monkey-patch to use headed mode
import gemini_worker
from playwright.sync_api import sync_playwright

LOG_FILE = os.path.join(gemini_worker.OUTPUT_DIR, "test_headed.log")

def flog(msg):
    """Log to both stderr and log file."""
    gemini_worker.log(msg)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"{msg}\n")

def snap(page, name):
    """Take a debug screenshot with a label."""
    path = os.path.join(gemini_worker.OUTPUT_DIR, f"step_{name}.png")
    page.screenshot(path=path)
    flog(f"  Screenshot: {path}")

def headed_main():
    # Clear the log file
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write("=== HEADED TEST ===\n")

    flog("=== HEADED TEST MODE ===")

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=gemini_worker.COOKIE_DIR,
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars",
                "--disable-dev-shm-usage",
                "--disable-extensions",
                "--disable-gpu",
                "--lang=vi-VN,vi,en-US,en",
            ],
            viewport={"width": 1280, "height": 900},
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            locale="vi-VN",
            timezone_id="Asia/Ho_Chi_Minh",
            extra_http_headers={
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
                "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
            },
        )

        # Inject anti-detection script
        browser.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            if (!window.chrome) {
                window.chrome = { runtime: {}, csi: function(){}, loadTimes: function(){} };
            }
        """)
        # Use existing page; close any extra tabs from restored session
        page = browser.pages[0]
        for extra in browser.pages[1:]:
            extra.close()

        try:
            flog("Step 1: Navigating to Gemini...")
            page.goto(gemini_worker.GEMINI_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_load_state("load", timeout=15000)
            time.sleep(3)

            if "accounts.google.com" in page.url or "signin" in page.url:
                raise Exception("Not logged in")

            gemini_worker._dismiss_dialogs(page)
            gemini_worker._start_new_conversation(page)
            snap(page, "1_loaded")

            flog("Step 2: Selecting Pro mode...")
            gemini_worker._select_pro_mode(page)
            snap(page, "2_pro")

            flog("Step 3: Clicking 'Tạo hình ảnh'...")
            gemini_worker._click_create_image(page)
            snap(page, "3_create_image")

            flog(f"Step 4: Selecting style '{gemini_worker.IMAGE_STYLE}'...")
            gemini_worker._select_style(page, gemini_worker.IMAGE_STYLE)
            time.sleep(2)
            snap(page, "4_style_selected")

            flog("Step 5: Uploading image...")
            gemini_worker._upload_image(page)
            snap(page, "5_uploaded")

            flog("Step 6a: Entering prompt...")
            gemini_worker._enter_prompt(page)
            snap(page, "6a_prompt")

            flog("Step 6b: Submitting...")
            resp_before = page.evaluate("document.querySelectorAll('response-element').length")
            flog(f"  Response elements before submit: {resp_before}")
            gemini_worker._submit_prompt(page)
            snap(page, "6b_submitted")

            flog("Step 7: Waiting for generation...")
            gemini_worker._wait_for_response(page, resp_before)
            snap(page, "7_generated")

            flog("Step 8: Downloading...")
            output = gemini_worker._download_via_button(page, resp_before)
            flog(f"SUCCESS: {output}")
            print(output)

        except Exception as e:
            flog(f"ERROR: {e}")
            import traceback
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                traceback.print_exc(file=f)
            snap(page, "error")
            time.sleep(5)
            browser.close()
            sys.exit(1)

        time.sleep(5)
        browser.close()

headed_main()
