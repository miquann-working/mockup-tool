"""
gemini_worker.py — Playwright automation for Gemini image generation.

Workflow:
  1. Navigate to Gemini → select Pro mode
  2. Click "Tạo hình ảnh" (Create image) tool
  3. Select "Chân dung dịu nhẹ" style (or configured style)
  4. Upload original image + enter prompt → submit
  5. Wait for generation
  6. Hover over generated image → click download button (best quality)

Environment variables (passed by jobRunner.js):
  COOKIE_DIR    — path to persistent browser context cookies
  IMAGE_PATH    — path to input image
  PROMPT_TEXT   — prompt to send to Gemini
  OUTPUT_PREFIX — prefix for output filename (e.g. mockup_1, line_1)
  IMAGE_STYLE   — style to select (default: "Chân dung dịu nhẹ")

Prints the output filename to stdout on success.
"""

import os
import sys
import time
import json
import random
import unicodedata
import shutil

COOKIE_DIR = os.environ.get("COOKIE_DIR", "")
IMAGE_PATH = os.environ.get("IMAGE_PATH", "")
PROMPT_TEXT = os.environ.get("PROMPT_TEXT", "")
OUTPUT_PREFIX = os.environ.get("OUTPUT_PREFIX", "output")
IMAGE_STYLE = os.environ.get("IMAGE_STYLE", "Chân dung dịu nhẹ")
SKIP_IMAGE_TOOL = os.environ.get("SKIP_IMAGE_TOOL", "") == "1"
HEADLESS = os.environ.get("HEADLESS", "") == "1"
JOBS_JSON = os.environ.get("JOBS_JSON", "")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs")

GEMINI_URL = "https://gemini.google.com/app"
MAX_WAIT_SECS = 600  # 10 min max wait for image generation


class RateLimitError(Exception):
    """Raised when Gemini rate-limits image generation for this account."""
    pass


def log(msg):
    print(f"[gemini_worker] {msg}", file=sys.stderr)


def human_delay(min_s=0.3, max_s=0.8):
    """Random micro-delay to mimic human behavior."""
    time.sleep(random.uniform(min_s, max_s))


def _norm(s):
    """Normalize Vietnamese text for comparison."""
    return unicodedata.normalize('NFC', s).lower().strip()


# ── Configurable selectors (loaded from automation/selectors.json) ──
def _load_selectors():
    """Load DOM selector config. Falls back to hardcoded defaults if file is missing."""
    defaults = {
        "create_image_terms": ["tạo hình ảnh", "create image"],
        "upload_button_aria": ["tải tệp", "upload", "mở trình đơn"],
        "upload_menu_terms": ["tải tệp", "upload file"],
        "consent_terms": ["đồng ý"],
        "send_aria_terms": ["send", "gửi", "submit"],
        "new_chat_terms": ["cuộc trò chuyện mới", "new chat"],
        "new_chat_href": "/app",
        "style_gallery_heading": ["chọn một kiểu", "choose a style"],
        "dismiss_button_terms": ["got it", "dismiss", "ok", "đồng ý"],
        "mode_text_keywords": ["nhanh", "pro", "flash", "ultra"],
        "mode_aria_keywords": ["chế độ", "mode", "bộ chọn", "model"],
        "rate_limit_terms": [
            "can't generate more images", "cannot generate more images",
            "đạt đến giới hạn", "giới hạn tạo hình ảnh",
            "come back tomorrow", "vui lòng đợi đến"
        ],
        "error_terms": ["lỗi", "error", "failed"],
        "creating_terms": ["creating your image", "đang tạo"],
        "stop_terms": ["stop", "cancel", "dừng", "hủy"],
        "close_button_aria": ["remove", "xóa", "close", "delete", "đóng"],
        "overlay_container": ".cdk-overlay-container",
        "dialog_selectors": ".image-expansion-dialog, .image-expansion-dialog-backdrop",
        "input_selectors": [
            ".ql-editor[contenteditable='true']",
            "[contenteditable='true'][aria-label*='Hỏi']",
            "[contenteditable='true'][aria-label*='prompt']",
            "[contenteditable='true'][aria-label*='Nhập']",
            "div[contenteditable='true']",
            "textarea"
        ],
        "focus_selectors": [".ql-editor[contenteditable='true']", "[contenteditable='true']", "textarea"],
        "style_card_selectors": "media-gen-template-card, .style-card, [class*='template-card']",
        "style_card_extended": (
            "media-gen-template-card, .style-card, [class*='template'], "
            "[class*='style'], [role='option'], [role='listitem'], "
            ".media-gen-zero-state-shell [role='button'], "
            "image-generation-zero-state [role='button']"
        ),
        "gallery_containers": (
            "media-gen-zero-state-shell, image-generation-zero-state, "
            "[class*='style-gallery'], [class*='template-gallery']"
        ),
        "response_element": "response-element",
        "generated_image_selectors": "generated-image img, .single-image img, .image-card img",
        "template_card": "media-gen-template-card",
        "input_preview_selectors": "user-query-file-preview, user-query-file-carousel",
        "thinking_selectors": ".thinking-label, .thought-chip, [class*='thinking'], [class*='thought']",
        "spinner_selectors": ".loading-indicator, [role='progressbar'], .spinner",
        "error_element_selectors": "snack-bar, .snackbar, [role='alert'], .error-message, .mdc-snackbar",
        "user_msg_selectors": "user-query, .user-message, .query-content",
        "viewport_bottom_ratio": 0.4,
        "sidebar_x_threshold": 100,
        "image_min_size": 200,
        "input_area_bottom_px": 250,
        "style_text_max_length": 100,
    }
    config_path = os.path.join(os.path.dirname(__file__), "selectors.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            user_config = json.load(f)
        merged = {**defaults, **user_config}
        merged.pop("_comment", None)
        log(f"Loaded selectors config ({len(user_config)} keys from selectors.json)")
        return merged
    except FileNotFoundError:
        return defaults
    except Exception as e:
        log(f"WARNING: selectors.json parse error: {e}, using defaults")
        return defaults


SEL = _load_selectors()


def _selector_fail_screenshot(page, func_name, context=""):
    """Take a debug screenshot when a selector search fails."""
    try:
        ts = int(time.time())
        filename = f"debug_sel_{func_name}_{ts}_{OUTPUT_PREFIX}.png"
        path = os.path.join(OUTPUT_DIR, filename)
        page.screenshot(path=path, full_page=True)
        log(f"  Selector fail screenshot: {filename} ({context})")
    except Exception:
        pass


def _clear_encrypted_cookies(cookie_dir):
    """Remove Chromium's encrypted cookie files before launch.

    Only needed for CROSS-PLATFORM scenarios (cookies created on Windows,
    used on Linux). When both are the same OS with --password-store=basic,
    the SQLite cookies are directly compatible and should NOT be cleared.
    """
    json_path = os.path.join(cookie_dir, "exported_cookies.json")
    if not os.path.isfile(json_path):
        return  # no JSON = local cookies, don't touch

    # Check platform marker — only clear if cookies were created on a different OS
    import platform as _platform
    current_os = _platform.system()  # 'Linux', 'Windows', 'Darwin'
    platform_file = os.path.join(cookie_dir, "cookie_platform.txt")
    if os.path.isfile(platform_file):
        try:
            with open(platform_file, "r") as f:
                source_os = f.read().strip()
            if source_os == current_os:
                log(f"  Cookies from same OS ({source_os}), keeping SQLite cookies")
                return  # Same OS → SQLite cookies are compatible
        except Exception:
            pass  # Can't read marker → assume cross-platform, clear

    log(f"  Cross-platform cookies detected, clearing encrypted SQLite cookies")
    targets = [
        os.path.join(cookie_dir, "Default", "Cookies"),
        os.path.join(cookie_dir, "Default", "Cookies-journal"),
    ]
    for f in targets:
        try:
            if os.path.isfile(f):
                os.remove(f)
                log(f"  Cleared encrypted cookie file: {os.path.basename(f)}")
        except Exception:
            pass


def _import_exported_cookies(browser, cookie_dir):
    """Import plaintext cookies from exported_cookies.json if present.

    When cookies are exported on Windows and used on Linux, Chromium's
    native encrypted cookie store is incompatible (DPAPI vs keyring).
    This injects the plaintext cookies via Playwright API to bypass
    the encryption layer entirely.
    """
    json_path = os.path.join(cookie_dir, "exported_cookies.json")
    if not os.path.isfile(json_path):
        return
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            cookies = json.load(f)
        if cookies:
            browser.add_cookies(cookies)
            log(f"Imported {len(cookies)} cookies from exported_cookies.json")
    except Exception as e:
        log(f"Warning: could not import exported cookies: {e}")


def main():
    if JOBS_JSON:
        return main_batch()

    if not COOKIE_DIR:
        log("ERROR: COOKIE_DIR not set")
        sys.exit(1)
    if not IMAGE_PATH or not os.path.isfile(IMAGE_PATH):
        log(f"ERROR: IMAGE_PATH invalid: {IMAGE_PATH}")
        sys.exit(1)
    if not PROMPT_TEXT:
        log("ERROR: PROMPT_TEXT not set")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("ERROR: Playwright not installed")
        sys.exit(1)

    log("Starting automation...")
    log(f"  COOKIE_DIR={COOKIE_DIR}")
    log(f"  IMAGE_PATH={IMAGE_PATH}")
    log(f"  PROMPT_TEXT={PROMPT_TEXT[:80]}...")
    log(f"  OUTPUT_PREFIX={OUTPUT_PREFIX}")
    log(f"  IMAGE_STYLE={IMAGE_STYLE}")

    with sync_playwright() as p:
        _cleanup_chrome_lock(COOKIE_DIR)
        _clear_encrypted_cookies(COOKIE_DIR)
        # --headless=new: Chromium's new headless renders identically to headed mode
        # We set Playwright headless=False and pass the flag manually to avoid
        # Playwright's old headless shell which is easily detected.
        _extra_args = []
        _headless = False
        if HEADLESS:
            _extra_args.append("--headless=new")
            _headless = True
        else:
            _extra_args.append("--window-position=-9999,-9999")
        import tempfile as _tempfile
        _cache_dir = _tempfile.mkdtemp(prefix="chromium_cache_")
        browser = p.chromium.launch_persistent_context(
            user_data_dir=COOKIE_DIR,
            headless=_headless,
            ignore_default_args=["--enable-automation"],
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-infobars",
                "--disable-dev-shm-usage",
                "--disable-extensions",
                "--disable-component-extensions-with-background-pages",
                "--disable-gpu",
                "--disable-software-rasterizer",
                "--disable-background-timer-throttling",
                "--disable-crash-reporter",
                "--disable-breakpad",
                "--disable-features=TranslateUI,BlinkGenPropertyTrees",
                "--lang=vi-VN,vi,en-US,en",
                "--password-store=basic",
                f"--disk-cache-dir={_cache_dir}",
                "--disk-cache-size=1",
                "--media-cache-size=1",
            ] + _extra_args,
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

        # Inject anti-detection script BEFORE any page loads
        browser.add_init_script("""
            // Override navigator.webdriver to hide automation
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

            // Ensure window.chrome exists (real Chrome always has this)
            if (!window.chrome) {
                window.chrome = { runtime: {}, csi: function(){}, loadTimes: function(){} };
            }

            // Override plugins to look like real Chrome
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });

            // Override languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['vi-VN', 'vi', 'en-US', 'en'],
            });

            // Fix permissions query for notifications
            const originalQuery = window.Notification && Notification.permission;
            if (window.Notification) {
                Notification.permission = 'default';
            }

            // Override hardware concurrency to realistic value
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });

            // Override deviceMemory
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        """)

        # Inject configurable selectors for JS access
        browser.add_init_script("window.__SEL = " + json.dumps(SEL) + ";")

        # Import plaintext cookies for cross-platform compatibility
        _import_exported_cookies(browser, COOKIE_DIR)

        # Use the first existing page; close any extra tabs from restored session
        page = browser.pages[0]
        for extra in browser.pages[1:]:
            extra.close()

        try:
            # ── Step 1: Navigate to Gemini ──
            log("Step 1: Navigating to Gemini...")
            page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_load_state("load", timeout=15000)

            if "accounts.google.com" in page.url or "signin" in page.url:
                raise Exception("Not logged in — session expired")

            # Dismiss any consent/welcome dialogs
            _dismiss_dialogs(page)
            human_delay()

            # Ensure we're on the chat page, not Notebooks/Gems/other sections
            _ensure_chat_page(page)

            # ── Step 1b: Start a fresh conversation ──
            # Persistent browser may reopen the last conversation with old images.
            # Always start fresh to avoid detecting stale response elements.
            _start_new_conversation(page)

            # Dismiss anything that _start_new_conversation may have triggered
            _dismiss_dialogs(page)
            time.sleep(0.3)

            # ── Step 2: Select Pro mode ──
            log("Step 2: Selecting Pro mode...")
            _select_pro_mode(page)
            time.sleep(0.5)

            if SKIP_IMAGE_TOOL:
                # Simple chat mode: just upload + prompt (for line drawing etc)
                log("Step 3: [SKIP] Using normal chat mode (no Tạo hình ảnh)")

                log("Step 4: Uploading image...")
                _upload_image(page)
                time.sleep(0.3)

                log("Step 5: Entering prompt...")
                _enter_prompt(page)
                time.sleep(0.3)

                log("Step 5b: Submitting...")
                resp_before = page.evaluate("document.querySelectorAll('response-element').length")
                log(f"  Response elements before submit: {resp_before}")
                _submit_prompt(page)
            else:
                # Full "Tạo hình ảnh" workflow with style selection
                log("Step 3: Clicking 'Tạo hình ảnh'...")
                gallery_visible = _click_create_image(page)
                time.sleep(0.5)

                if gallery_visible:
                    log(f"Step 4: Selecting style '{IMAGE_STYLE}'...")
                    _select_style(page, IMAGE_STYLE)
                    time.sleep(0.5)
                else:
                    log(f"Step 4: Style gallery not open (tool active, style remembered) ✓")

                log("Step 5: Uploading image...")
                _upload_image(page)
                time.sleep(0.3)

                log("Step 6a: Entering prompt...")
                _enter_prompt(page)
                time.sleep(0.3)

                log("Step 6b: Submitting...")
                resp_before = page.evaluate("document.querySelectorAll('response-element').length")
                log(f"  Response elements before submit: {resp_before}")
                _submit_prompt(page)

            # ── Step 7: Wait for generation ──
            log("Step 7: Waiting for Gemini to generate...")
            _wait_for_response(page, resp_before)

            # ── Step 8: Download via hover + download button ──
            log("Step 8: Downloading generated image...")
            output_filename = _download_via_button(page, resp_before)

            log(f"SUCCESS: {output_filename}")
            print(output_filename)

        except RateLimitError:
            log("RATE_LIMITED: Account hit Gemini image generation limit")
            print("RATE_LIMITED", flush=True)
            browser.close()
            sys.exit(2)

        except Exception as e:
            log(f"ERROR: {e}")
            try:
                debug_path = os.path.join(OUTPUT_DIR, f"debug_{OUTPUT_PREFIX}.png")
                page.screenshot(path=debug_path)
                log(f"Debug screenshot saved: {debug_path}")
            except Exception:
                pass
            browser.close()
            sys.exit(1)

        browser.close()


def _cleanup_chrome_lock(cookie_dir):
    """Remove Chrome lock files from a user-data dir to prevent TargetClosedError.
    Also kills any lingering Chrome processes using this profile.
    """
    import glob
    import subprocess
    lock_files = ["SingletonLock", "SingletonSocket", "SingletonCookie"]
    for lf in lock_files:
        lock_path = os.path.join(cookie_dir, lf)
        try:
            if os.path.exists(lock_path):
                os.remove(lock_path)
                log(f"  Removed lock file: {lf}")
        except Exception:
            pass
    # Kill any Chrome processes using this specific profile directory
    try:
        dir_name = os.path.basename(os.path.normpath(cookie_dir))
        result = subprocess.run(
            ["taskkill", "/F", "/FI", f"WINDOWTITLE eq *{dir_name}*"],
            capture_output=True, timeout=5
        )
    except Exception:
        pass
    try:
        # Also check for chrome.exe with the profile dir in command line
        result = subprocess.run(
            ["wmic", "process", "where",
             f"name='chrome.exe' and commandline like '%{cookie_dir.replace(os.sep, os.sep + os.sep)}%'",
             "delete"],
            capture_output=True, timeout=5
        )
    except Exception:
        pass


def _launch_browser(p):
    """Launch persistent Chromium browser and return (browser, page)."""
    _cleanup_chrome_lock(COOKIE_DIR)
    _clear_encrypted_cookies(COOKIE_DIR)
    _extra_args = []
    _headless = False
    if HEADLESS:
        _extra_args.append("--headless=new")
        _headless = True
    else:
        _extra_args.append("--window-position=-9999,-9999")
    import tempfile as _tempfile
    _cache_dir = _tempfile.mkdtemp(prefix="chromium_cache_")
    browser = p.chromium.launch_persistent_context(
        user_data_dir=COOKIE_DIR,
        headless=_headless,
        ignore_default_args=["--enable-automation"],
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-infobars",
            "--disable-dev-shm-usage",
            "--disable-extensions",
            "--disable-component-extensions-with-background-pages",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-background-timer-throttling",
            "--disable-crash-reporter",
            "--disable-breakpad",
            "--disable-features=TranslateUI,BlinkGenPropertyTrees",
            "--lang=vi-VN,vi,en-US,en",
            "--password-store=basic",
            f"--disk-cache-dir={_cache_dir}",
            "--disk-cache-size=1",
            "--media-cache-size=1",
        ] + _extra_args,
        viewport={"width": 1280, "height": 900},
        accept_downloads=True,
        permissions=["clipboard-read", "clipboard-write"],
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

    browser.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        if (!window.chrome) {
            window.chrome = { runtime: {}, csi: function(){}, loadTimes: function(){} };
        }
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    """)

    # Inject configurable selectors for JS access
    browser.add_init_script("window.__SEL = " + json.dumps(SEL) + ";")

    # Import plaintext cookies for cross-platform compatibility
    _import_exported_cookies(browser, COOKIE_DIR)

    page = browser.pages[0]
    for extra in browser.pages[1:]:
        extra.close()
    # Minimize browser window to keep it off-screen
    try:
        cdp = browser.new_cdp_session(page)
        cdp.send("Browser.getWindowForTarget")
        win = cdp.send("Browser.getWindowForTarget")
        cdp.send("Browser.setWindowBounds", {
            "windowId": win["windowId"],
            "bounds": {"windowState": "minimized"}
        })
    except Exception:
        pass
    return browser, page


def main_batch():
    """Batch mode: process multiple jobs in ONE Gemini conversation for consistent output."""
    global PROMPT_TEXT, OUTPUT_PREFIX
    import json

    jobs = json.loads(JOBS_JSON)
    if not jobs:
        log("ERROR: JOBS_JSON is empty")
        sys.exit(1)

    if not COOKIE_DIR:
        log("ERROR: COOKIE_DIR not set")
        sys.exit(1)
    if not IMAGE_PATH or not os.path.isfile(IMAGE_PATH):
        log(f"ERROR: IMAGE_PATH invalid: {IMAGE_PATH}")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("ERROR: Playwright not installed")
        sys.exit(1)

    log(f"Starting BATCH automation ({len(jobs)} jobs in 1 conversation)...")
    log(f"  COOKIE_DIR={COOKIE_DIR}")
    log(f"  IMAGE_PATH={IMAGE_PATH}")
    log(f"  IMAGE_STYLE={IMAGE_STYLE}")
    for i, j in enumerate(jobs):
        log(f"  Job {i}: prefix={j['outputPrefix']}, prompt={j['promptText'][:50]}...")

    with sync_playwright() as p:
        browser, page = _launch_browser(p)

        try:
            # ── Setup: Navigate + New Conversation + Pro Mode ──
            log("Setup: Navigating to Gemini...")
            page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_load_state("load", timeout=15000)

            if "accounts.google.com" in page.url or "signin" in page.url:
                raise Exception("Not logged in — session expired")

            _dismiss_dialogs(page)
            human_delay()
            _start_new_conversation(page)

            # Dismiss anything that _start_new_conversation may have triggered
            _dismiss_dialogs(page)
            time.sleep(0.3)

            log("Setup: Selecting Pro mode...")
            _select_pro_mode(page)
            human_delay()

            results = []
            JOB_MAX_RETRIES = 3  # per-job retry within the same conversation

            for i, job_data in enumerate(jobs):
                PROMPT_TEXT = job_data['promptText']
                OUTPUT_PREFIX = job_data['outputPrefix']

                # Signal backend: this job is now being processed
                print(f"STARTING:{i}", flush=True)

                log("")
                log(f"{'='*50}")
                log(f"  BATCH JOB {i+1}/{len(jobs)}: {OUTPUT_PREFIX}")
                log(f"  Prompt: {PROMPT_TEXT[:60]}...")
                log(f"{'='*50}")

                job_done = False
                for attempt in range(JOB_MAX_RETRIES):
                    try:
                        # ── Step 1: Activate "Tạo hình ảnh" + select style ──
                        if SKIP_IMAGE_TOOL:
                            log("  [SKIP] Using normal chat mode")
                        elif i == 0 and attempt == 0:
                            log("  Step 1: Clicking 'Tạo hình ảnh'...")
                            gallery_visible = _click_create_image(page)
                            time.sleep(0.5)
                            if gallery_visible:
                                log(f"  Step 2: Selecting style '{IMAGE_STYLE}'...")
                                _select_style(page, IMAGE_STYLE)
                                time.sleep(0.5)
                        elif not SKIP_IMAGE_TOOL:
                            # For retries or subsequent jobs: ensure tool is still active
                            needs_style = _ensure_create_image_active(page)
                            if needs_style:
                                log(f"  Step 2 (re-activate): Selecting style '{IMAGE_STYLE}'...")
                                _select_style(page, IMAGE_STYLE)
                                time.sleep(0.5)
                        # For subsequent jobs: tool stays active, style is remembered

                        # ── Step 3: Upload image ──
                        # First clear any leftover images from previous attempts
                        existing_imgs = _count_input_images(page)
                        if existing_imgs > 0:
                            log(f"  Step 3: Clearing {existing_imgs} leftover image(s) first...")
                            _clear_input_area(page)
                            time.sleep(0.3)
                        log("  Step 3: Uploading image...")
                        _upload_image(page)
                        time.sleep(0.3)

                        # ── Step 4: Enter prompt ──
                        log("  Step 4: Entering prompt...")
                        _enter_prompt(page)
                        time.sleep(0.3)

                        # ── Step 5: Submit ──
                        resp_before = page.evaluate("document.querySelectorAll('response-element').length")
                        log(f"  Step 5: Submitting... (resp_before={resp_before})")
                        _submit_prompt(page)

                        # ── Step 6: Wait for generation ──
                        log("  Step 6: Waiting for generation...")
                        _wait_for_response(page, resp_before)

                        # ── Step 7: Download (JS only, no clicking on image) ──
                        log("  Step 7: Downloading...")
                        output_filename = _download_via_button(page, resp_before)

                        results.append(output_filename)
                        print(f"{i}:{output_filename}", flush=True)
                        log(f"  ✓ Batch job {i+1} done: {output_filename}")
                        job_done = True
                        break  # success — exit retry loop

                    except RateLimitError:
                        # Rate limit — don't retry, bubble up immediately
                        raise
                    except Exception as job_err:
                        log(f"  ✗ Job {i+1} attempt {attempt+1}/{JOB_MAX_RETRIES} failed: {job_err}")
                        try:
                            debug_path = os.path.join(OUTPUT_DIR, f"debug_job{i}_attempt{attempt}_{OUTPUT_PREFIX}.png")
                            page.screenshot(path=debug_path)
                        except Exception:
                            pass
                        if attempt < JOB_MAX_RETRIES - 1:
                            log(f"  Retrying job {i+1}...")
                            # Clean up: remove overlays, clear leftover images and text
                            _dismiss_dialogs(page)
                            time.sleep(0.3)
                            _clear_input_area(page)
                            time.sleep(0.5)
                            # Re-activate "Tạo hình ảnh" tool (may have been lost)
                            try:
                                gallery = _ensure_create_image_active(page)
                                if gallery:
                                    _select_style(page)
                            except Exception as reactivate_err:
                                log(f"  Warning: Could not re-activate tool: {reactivate_err}")

                if not job_done:
                    print(f"JOB_ERROR:{i}", flush=True)
                    log(f"  ✗✗ Job {i+1} failed after {JOB_MAX_RETRIES} retries, aborting batch")
                    raise Exception(f"Job {i+1} ({OUTPUT_PREFIX}) failed after {JOB_MAX_RETRIES} retries")

                # Between jobs: just scroll down and wait — Gemini clears input after send
                if i < len(jobs) - 1:
                    current_url = page.url
                    if "accounts.google.com" in current_url or "signin" in current_url:
                        raise Exception(f"Session expired after job {i+1}")

                    log("  Scrolling down for next job...")
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(1.0)
                    # Remove any overlays that appeared (image expansion, etc.)
                    _dismiss_dialogs(page)
                    time.sleep(0.5)

            log(f"BATCH SUCCESS: {len(results)}/{len(jobs)} jobs completed")

        except RateLimitError:
            log("RATE_LIMITED: Account hit Gemini image generation limit")
            print("RATE_LIMITED", flush=True)
            browser.close()
            sys.exit(2)

        except Exception as e:
            log(f"BATCH ERROR: {e}")
            try:
                debug_path = os.path.join(OUTPUT_DIR, f"debug_batch_{OUTPUT_PREFIX}.png")
                page.screenshot(path=debug_path)
                log(f"Debug screenshot saved: {debug_path}")
            except Exception:
                pass
            browser.close()
            sys.exit(1)

        browser.close()


# ─────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────

def _dismiss_dialogs(page):
    """Remove any blocking overlays — DOM removal + close button clicks + Escape."""
    # 0. Press Escape first to close any focused overlay (menus, dropdowns)
    try:
        page.keyboard.press("Escape")
        time.sleep(0.15)
    except Exception:
        pass

    # 1. Click X/close icon buttons via aria-label (graceful close before DOM nuke)
    try:
        close_aria = SEL.get("popup_close_aria", ["close", "đóng", "dismiss", "cancel", "hủy", "tắt"])
        page.evaluate('''(closeTerms) => {
            // Only click close buttons that are inside overlays/dialogs, not in main UI
            const overlayContainer = document.querySelector('.cdk-overlay-container');
            const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
            const containers = [overlayContainer, ...dialogs].filter(Boolean);
            for (const container of containers) {
                const btns = container.querySelectorAll('button, [role="button"]');
                for (const btn of btns) {
                    if (btn.offsetParent === null) continue;
                    const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
                    if (closeTerms.some(t => aria.includes(t))) {
                        try { btn.click(); } catch(e) {}
                    }
                }
            }
        }''', close_aria)
        time.sleep(0.15)
    except Exception:
        pass

    # 2. Remove ALL CDK overlays (context menus, image dialogs, dropdowns, tooltips)
    try:
        closed = page.evaluate('''() => {
            const S = window.__SEL || {};
            let closed = 0;
            // Remove all overlay panes and backdrops
            const overlayContainer = document.querySelector(
                S.overlay_container || '.cdk-overlay-container'
            );
            if (overlayContainer) {
                while (overlayContainer.firstChild) {
                    overlayContainer.removeChild(overlayContainer.firstChild);
                    closed++;
                }
            }
            // Remove image expansion dialog elements
            const dialogs = document.querySelectorAll(
                S.dialog_selectors || '.image-expansion-dialog, .image-expansion-dialog-backdrop'
            );
            for (const d of dialogs) {
                try { d.remove(); closed++; } catch(e) {}
            }
            // Remove role="dialog" overlays (structural fallback)
            const roleDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
            for (const d of roleDialogs) {
                if (d.offsetParent !== null) {
                    try { d.remove(); closed++; } catch(e) {}
                }
            }
            // Remove backdrop/scrim layers that block interaction
            const backdrops = document.querySelectorAll(
                '.cdk-overlay-backdrop, .modal-backdrop, .scrim, [class*="backdrop"], [class*="scrim"]'
            );
            for (const b of backdrops) {
                try { b.remove(); closed++; } catch(e) {}
            }
            return closed;
        }''')
        if closed > 0:
            log(f"  Removed {closed} overlay elements")
            time.sleep(0.2)
    except Exception:
        pass

    # 3. Close inline feedback dialogs ("Đã xảy ra lỗi gì?", surveys, etc.)
    #    These have X/close buttons but aren't in CDK overlays
    try:
        page.evaluate('''() => {
            // Find elements containing feedback survey text and close them
            const feedbackTerms = ["đã xảy ra lỗi", "what went wrong", "send feedback", "gửi phản hồi"];
            const allEls = document.querySelectorAll('div, section, aside, form');
            for (const el of allEls) {
                if (el.offsetParent === null) continue;
                const text = (el.innerText || "").toLowerCase().substring(0, 200);
                if (!feedbackTerms.some(t => text.includes(t))) continue;
                // Found a feedback panel — click its close button
                const closeBtn = el.querySelector('button[aria-label*="close"], button[aria-label*="đóng"], button[aria-label*="Close"]');
                if (closeBtn) { try { closeBtn.click(); } catch(e) {} continue; }
                // Try generic X button (small button near top-right of the panel)
                const btns = el.querySelectorAll('button');
                for (const btn of btns) {
                    const rect = btn.getBoundingClientRect();
                    const parentRect = el.getBoundingClientRect();
                    // X button is typically in the top-right corner, small
                    if (rect.width < 50 && rect.height < 50 &&
                        rect.right > parentRect.right - 60 &&
                        rect.top < parentRect.top + 60) {
                        try { btn.click(); } catch(e) {}
                        break;
                    }
                }
            }
        }''')
        time.sleep(0.15)
    except Exception:
        pass

    # 4. Close consent/welcome/promo dialogs (config-driven button terms)
    try:
        dismiss_terms = SEL.get("popup_dismiss_terms", SEL.get("dismiss_button_terms", []))
        for term in dismiss_terms:
            try:
                btn = page.query_selector(f'button:has-text("{term}")')
                if btn and btn.is_visible():
                    # Skip buttons that are navigation links (could navigate away)
                    tag = btn.evaluate("el => el.tagName.toLowerCase()")
                    href = btn.get_attribute("href") or ""
                    if tag == "a" and href and not href.startswith("#"):
                        continue
                    btn.click()
                    time.sleep(0.2)
            except Exception:
                pass
    except Exception:
        pass


def _ensure_chat_page(page):
    """Ensure we're on the Gemini chat page, not Notebooks/Gems/other sections.
    
    Persistent browser may reopen the last-used section (e.g. Sổ ghi chú / Notebooks).
    If the chat input area is missing, navigate to a new conversation.
    """
    has_input = page.evaluate('''() => {
        const inputs = document.querySelectorAll('[contenteditable="true"], textarea, .ql-editor, [role="textbox"]');
        const vh = window.innerHeight;
        for (const el of inputs) {
            if (el.offsetParent === null) continue;
            const rect = el.getBoundingClientRect();
            if (rect.bottom > vh * 0.4 && rect.height > 10) return true;
        }
        return false;
    }''')

    if has_input:
        return  # Already on chat page

    log("  Not on chat page (no input area found), redirecting...")

    # Try clicking "Cuộc trò chuyện mới" / "New chat" in sidebar
    new_chat_norms = [_norm(t) for t in SEL.get("new_chat_terms", ["cuộc trò chuyện mới", "new chat"])]
    clicked = False
    for btn in page.query_selector_all('a, button'):
        try:
            text = _norm(btn.inner_text() or "")
            aria = _norm(btn.get_attribute("aria-label") or "")
            href = btn.get_attribute("href") or ""
            if (any(t in text or t in aria for t in new_chat_norms) or href == "/app"):
                if btn.is_visible():
                    log(f"  Clicking '{text or aria}' to return to chat")
                    btn.click()
                    page.wait_for_load_state("domcontentloaded", timeout=10000)
                    time.sleep(0.5)
                    clicked = True
                    break
        except Exception:
            continue

    if not clicked:
        # Fallback: navigate directly
        log("  Navigating to fresh Gemini URL...")
        page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_load_state("load", timeout=10000)

    _dismiss_dialogs(page)
    time.sleep(0.3)


def _start_new_conversation(page):
    """Start a fresh conversation so old response images don't interfere.
    
    Tries: 1) Click 'Cuộc trò chuyện mới' button, 2) Navigate to /app with fresh URL.
    """
    # Check if there are any existing response elements (= old conversation loaded)
    existing = page.evaluate("document.querySelectorAll('response-element').length")
    if existing == 0:
        log("  Already on a fresh conversation")
        return

    log(f"  Old conversation detected ({existing} responses), starting new one...")

    # Method 1: Click "Cuộc trò chuyện mới" / "New chat" button
    new_chat_norms = [_norm(t) for t in SEL["new_chat_terms"]]
    new_chat_href = SEL.get("new_chat_href", "/app")
    for btn in page.query_selector_all('a, button'):
        try:
            text = _norm(btn.inner_text() or "")
            aria = _norm(btn.get_attribute("aria-label") or "")
            href = btn.get_attribute("href") or ""
            if (any(t in text or t in aria for t in new_chat_norms) or
                href == new_chat_href):
                if btn.is_visible():
                    log(f"  Clicking new chat button: '{text or aria}'")
                    btn.click()
                    page.wait_for_load_state("domcontentloaded", timeout=10000)
                    time.sleep(0.3)
                    # Verify we're on a fresh page
                    remaining = page.evaluate("document.querySelectorAll('response-element').length")
                    if remaining == 0:
                        log("  New conversation started ✓")
                        return
        except Exception:
            continue

    # Method 2: Navigate directly
    log("  Navigating to fresh URL...")
    page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=15000)
    page.wait_for_load_state("load", timeout=10000)
    _dismiss_dialogs(page)
    
    remaining = page.evaluate("document.querySelectorAll('response-element').length")
    if remaining == 0:
        log("  New conversation via navigation ✓")
    else:
        log(f"  WARNING: Still {remaining} old responses after navigation")


def _select_pro_mode(page):
    """Ensure Pro mode is selected (not Nhanh/Flash).
    
    The mode selector is the dropdown in the chat INPUT area (bottom),
    NOT the plan badge at the top-right corner (ULTRA/PRO label).
    """
    # Use JS to find the mode selector in the input area (bottom half of page)
    # The top-right badge (ULTRA/PRO) is NOT interactive — skip it
    mode_info = page.evaluate('''() => {
        const S = window.__SEL || {};
        const btns = document.querySelectorAll('button');
        const vh = window.innerHeight;
        let bestBtn = null;
        let bestText = "";
        const modeKeywords = S.mode_text_keywords || ["nhanh", "pro", "flash", "ultra"];
        const ariaKeywords = S.mode_aria_keywords || ["chế độ", "mode", "bộ chọn", "model"];
        
        for (const btn of btns) {
            if (btn.offsetParent === null) continue;
            const rect = btn.getBoundingClientRect();
            // Only consider buttons in the bottom half (input area)
            if (rect.top < vh * 0.4) continue;
            
            const text = (btn.innerText || "").normalize("NFC").toLowerCase().trim();
            const aria = (btn.getAttribute("aria-label") || "").normalize("NFC").toLowerCase().trim();
            
            const hasKeyword = modeKeywords.some(k => text.includes(k)) ||
                               ariaKeywords.some(k => aria.includes(k));
            if (!hasKeyword) continue;
            
            bestBtn = btn;
            bestText = text;
            break;
        }
        
        if (!bestBtn) return null;
        return { text: bestText };
    }''')

    if not mode_info:
        log("  Mode selector not found in input area, assuming Pro is default")
        return

    current_text = mode_info['text']
    log(f"  Found mode selector in input area: text='{current_text}'")
    
    if "pro" in current_text:
        log("  Already in Pro mode")
        return

    # Click mode button via JS (avoids Playwright timeout if button is briefly disabled)
    page.evaluate('''() => {
        const S = window.__SEL || {};
        const btns = document.querySelectorAll('button');
        const vh = window.innerHeight;
        const keywords = S.mode_text_keywords || ["nhanh", "pro", "flash", "ultra"];
        for (const btn of btns) {
            if (btn.offsetParent === null) continue;
            const rect = btn.getBoundingClientRect();
            if (rect.top < vh * 0.4) continue;
            const text = (btn.innerText || "").normalize("NFC").toLowerCase().trim();
            if (keywords.some(k => text.includes(k))) {
                btn.click();
                return;
            }
        }
    }''')
    time.sleep(0.5)

    # Select "Pro" from dropdown using JS to avoid Playwright's enabled-check timeout
    selected = page.evaluate('''() => {
        const items = document.querySelectorAll('[role="menuitem"], [role="option"], button, li');
        for (const item of items) {
            const text = (item.innerText || "").normalize("NFC").toLowerCase().trim();
            if (text !== "pro") continue;
            if (item.offsetParent === null) continue;
            
            // Check if disabled
            const isDisabled = item.hasAttribute("disabled") ||
                item.getAttribute("aria-disabled") === "true" ||
                item.classList.contains("disabled");
            if (isDisabled) {
                return "disabled";
            }
            item.click();
            return "clicked";
        }
        return "not_found";
    }''')

    if selected == "clicked":
        log("  Selected Pro mode")
        time.sleep(0.3)
    elif selected == "disabled":
        log("  Pro option is disabled, using current mode instead")
        # Close the dropdown by pressing Escape
        page.keyboard.press("Escape")
        time.sleep(0.2)
    else:
        log("  Could not find Pro option, continuing with current mode")
        page.keyboard.press("Escape")
        time.sleep(0.2)


def _click_create_image(page):
    """Click the 'Tạo hình ảnh' (Create image) button. Called ONCE at start.
    
    Returns True if style gallery opened, False if tool was activated without gallery.
    """
    # Dismiss any blocking overlays/feedback dialogs first
    _dismiss_dialogs(page)

    target_terms = [_norm(t) for t in SEL["create_image_terms"]]
    sidebar_x = SEL.get("sidebar_x_threshold", 100)

    # Method 1: Text/aria matching on buttons
    for btn in page.query_selector_all('button'):
        try:
            text = _norm(btn.inner_text() or "")
            aria = _norm(btn.get_attribute("aria-label") or "")
            if any(t in text or t in aria for t in target_terms):
                if btn.is_visible():
                    box = btn.bounding_box()
                    if box and box['x'] < sidebar_x and box['y'] < 200:
                        continue  # Skip sidebar buttons (top-left area only)
                    log(f"  Found 'Tạo hình ảnh' button")
                    btn.click()
                    time.sleep(1.0)
                    return _is_style_gallery_visible(page)
        except Exception:
            continue

    # Method 1b: "Tạo hình ảnh" may be inside the "Công cụ" (Tools) dropdown
    tools_btn = None
    for btn in page.query_selector_all('button'):
        try:
            text = _norm(btn.inner_text() or "")
            if text in ["công cụ", "tools"] and btn.is_visible():
                box = btn.bounding_box()
                if box and box['y'] > page.evaluate("window.innerHeight") * 0.7:
                    tools_btn = btn
                    break
        except Exception:
            continue
    if tools_btn:
        log("  Found 'Công cụ' dropdown, opening...")
        tools_btn.click()
        time.sleep(0.5)
        # Now search inside the opened dropdown/menu
        for item in page.query_selector_all('[role="menuitem"], [role="option"], button, [class*="menu"] button'):
            try:
                text = _norm(item.inner_text() or "")
                aria = _norm(item.get_attribute("aria-label") or "")
                if any(t in text or t in aria for t in target_terms):
                    if item.is_visible():
                        log(f"  Found 'Tạo hình ảnh' inside Tools dropdown")
                        item.click()
                        time.sleep(1.0)
                        return _is_style_gallery_visible(page)
            except Exception:
                continue
        # Close dropdown if we didn't find it
        page.keyboard.press("Escape")
        time.sleep(0.2)

    # Method 2: Structural fallback — look for tool buttons by icon in the input toolbar
    # GUARDS: Skip buttons inside response-elements, overlays, or dialogs
    fallback = page.evaluate('''() => {
        const S = window.__SEL || {};
        const vh = window.innerHeight;
        const respSel = S.response_element || 'response-element';
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
            if (btn.offsetParent === null) continue;
            const rect = btn.getBoundingClientRect();
            if (rect.top < vh * 0.7) continue;  // Only bottom 30% (input toolbar area)
            // Skip buttons inside response elements, overlays, or dialogs
            if (btn.closest(respSel + ', model-response, .cdk-overlay-container, [role="dialog"]')) continue;
            // Check for mat-icon with SPECIFIC image generation names (not generic "image")
            const icon = btn.querySelector('mat-icon, [class*="icon"]');
            if (icon) {
                const iconText = (icon.textContent || "").trim().toLowerCase();
                if (["imagesmode", "palette", "brush"].includes(iconText)) {
                    btn.click();
                    return true;
                }
            }
            // Check for data-tool-id or similar data attributes
            const toolId = btn.getAttribute("data-tool-id") || btn.getAttribute("data-action") || "";
            if (toolId.toLowerCase().includes("image")) {
                btn.click();
                return true;
            }
        }
        return false;
    }''')
    if fallback:
        log("  Found 'Tạo hình ảnh' button via structural fallback")
        time.sleep(1.0)
        return _is_style_gallery_visible(page)

    _selector_fail_screenshot(page, "click_create_image", "no button matched text or structure")
    raise Exception("Cannot find 'Tạo hình ảnh' button")


def _is_style_gallery_visible(page):
    """Check if the style gallery is currently visible."""
    return page.evaluate('''() => {
        const S = window.__SEL || {};
        const headingTerms = S.style_gallery_heading || ["chọn một kiểu", "choose a style"];
        const maxLen = S.style_text_max_length || 100;
        // Check for gallery heading — search ALL elements, not just h1-h3
        const allEls = document.querySelectorAll('h1, h2, h3, h4, p, div, span');
        for (const el of allEls) {
            if (el.offsetParent === null) continue;
            const t = (el.innerText || "").normalize("NFC").toLowerCase();
            if (headingTerms.some(h => t.includes(h))) {
                // Make sure this is the heading itself, not a huge parent container
                if (t.length < maxLen) return true;
            }
        }
        // Check for gallery container with style cards
        const cards = document.querySelectorAll(
            S.style_card_selectors || 'media-gen-template-card, .style-card, [class*="template-card"]'
        );
        let visibleCards = 0;
        for (const c of cards) {
            if (c.offsetParent !== null) visibleCards++;
        }
        return visibleCards >= 2;
    }''')


def _ensure_create_image_active(page):
    """For subsequent jobs in a batch, ensure the 'Tạo hình ảnh' tool is still active.

    In a conversation, the tool chip may persist or disappear after generation.
    If not active, re-activate it.
    
    Returns True if style gallery is visible (needs style selection), False otherwise.
    """
    # Dismiss overlays first so we don't read stale UI state
    _dismiss_dialogs(page)

    is_active = page.evaluate('''() => {
        const S = window.__SEL || {};
        const terms = S.create_image_terms || ["tạo hình ảnh", "create image"];
        const threshold = S.viewport_bottom_ratio || 0.4;
        const respSel = S.response_element || 'response-element';
        // Check for "Tạo hình ảnh" chip/badge in the input area (bottom)
        const vh = window.innerHeight;
        const els = document.querySelectorAll('button, [class*="chip"], [class*="tool"]');
        for (const el of els) {
            if (el.offsetParent === null) continue;
            const rect = el.getBoundingClientRect();
            if (rect.top < vh * threshold) continue;  // Only check bottom half (input area)
            // Skip elements inside response elements or overlays
            if (el.closest(respSel + ', model-response, .cdk-overlay-container, [role="dialog"]')) continue;
            const text = (el.innerText || "").normalize("NFC").toLowerCase().trim();
            // Must specifically match create_image_terms, NOT "canvas" or other tools
            if (terms.some(t => text.includes(t))) {
                // Double-check: reject if text contains "canvas" (wrong tool)
                if (text.includes("canvas")) continue;
                return true;
            }
        }
        return false;
    }''')

    if is_active:
        log("  'Tạo hình ảnh' tool still active ✓")
        return _is_style_gallery_visible(page)

    log("  'Tạo hình ảnh' tool not active, re-activating...")
    gallery_opened = _click_create_image(page)
    return gallery_opened


def _select_style(page, style_name):
    """Select an image style from the style gallery.
    
    Uses targeted JS evaluation to find style cards instead of iterating all DOM elements.
    Waits for gallery to actually appear before searching for cards.
    """
    target = _norm(style_name)
    
    # Wait for style gallery to fully load (poll for up to 5 seconds)
    gallery_ready = False
    for wait_attempt in range(10):
        gallery_ready = page.evaluate('''() => {
            const S = window.__SEL || {};
            const cards = document.querySelectorAll(
                S.style_card_selectors || 'media-gen-template-card, .style-card, [class*="template-card"]'
            );
            // At least a few style cards should be visible
            let visibleCards = 0;
            for (const c of cards) {
                if (c.offsetParent !== null) visibleCards++;
            }
            return visibleCards >= 2;
        }''')
        if gallery_ready:
            break
        time.sleep(0.5)
    
    if not gallery_ready:
        log("  Style gallery not fully loaded, trying anyway...")

    max_scrolls = 15
    for attempt in range(max_scrolls + 1):
        # Use a single JS call to find the matching style card — much faster than query_selector_all('*')
        found = page.evaluate('''(target) => {
            const S = window.__SEL || {};
            // Look for style cards: typically divs/buttons with an image and a short text label
            const candidates = document.querySelectorAll(
                S.style_card_extended || (
                    'media-gen-template-card, .style-card, [class*="template"], ' +
                    '[class*="style"], [role="option"], [role="listitem"], ' +
                    '.media-gen-zero-state-shell [role="button"], ' +
                    'image-generation-zero-state [role="button"]'
                )
            );
            
            function norm(s) {
                return (s || "").normalize("NFC").toLowerCase().trim();
            }
            
            // Method 1: Try known card selectors
            for (const el of candidates) {
                if (el.offsetParent === null) continue;
                const text = norm(el.innerText || "");
                if (text === target || (text.includes(target) && text.length < 40)) {
                    el.click();
                    return "clicked_card";
                }
            }
            
            // Method 2: Look for any visible element with short text matching the style name
            // Use a targeted set of possible card tags instead of '*'
            const tags = document.querySelectorAll('div, button, a, li, label, span, figure');
            for (const el of tags) {
                if (el.offsetParent === null) continue;
                const text = norm(el.innerText || "");
                if (text !== target && !(text.includes(target) && text.length < 30)) continue;
                // Verify it looks like a card (has image child or small size)
                if (el.children.length > 15) continue;
                const hasImg = el.querySelector('img') !== null;
                const rect = el.getBoundingClientRect();
                const isCard = hasImg || (rect.width > 80 && rect.width < 400 && rect.height > 80);
                if (isCard) {
                    el.click();
                    return "clicked_tag:" + el.tagName;
                }
            }
            
            return null;
        }''', target)

        if found:
            log(f"  Selected style '{style_name}' ({found})")
            time.sleep(0.5)
            # Scroll down to the input area — the gallery heading may stay visible
            # but the style is selected once we click the card
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(0.5)
            # Verify style was applied: check for "Tạo hình ảnh" chip in the input area
            style_applied = page.evaluate('''() => {
                const S = window.__SEL || {};
                const terms = S.create_image_terms || ["tạo hình ảnh", "create image"];
                const threshold = S.viewport_bottom_ratio || 0.4;
                const vh = window.innerHeight;
                const els = document.querySelectorAll('button, [class*="chip"], [class*="tool"]');
                for (const el of els) {
                    if (el.offsetParent === null) continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.top < vh * threshold) continue;
                    const text = (el.innerText || "").normalize("NFC").toLowerCase().trim();
                    if (terms.some(t => text.includes(t))) {
                        return true;
                    }
                }
                return false;
            }''')
            if style_applied:
                log("  Style applied, input area ready ✓")
            else:
                log("  WARNING: 'Tạo hình ảnh' chip not found, but style was clicked — proceeding")
            return

        if attempt < max_scrolls:
            # Scroll gallery container or window to reveal more styles
            # Find the actual scrollable container by walking up from the gallery heading
            page.evaluate('''() => {
                const S = window.__SEL || {};
                const headingTerms = S.style_gallery_heading || ["chọn một kiểu", "choose a style"];
                // Method 1: Find known gallery containers
                const known = document.querySelector(
                    S.gallery_containers || (
                        'media-gen-zero-state-shell, image-generation-zero-state, ' +
                        '[class*="style-gallery"], [class*="template-gallery"]'
                    )
                );
                if (known && known.scrollHeight > known.clientHeight) {
                    known.scrollTop += 400;
                    return;
                }
                // Method 2: Find the heading and walk up to find scrollable parent
                const headings = document.querySelectorAll('h1, h2, h3');
                for (const h of headings) {
                    const t = (h.innerText || "").toLowerCase();
                    if (headingTerms.some(ht => t.includes(ht))) {
                        let el = h.parentElement;
                        for (let i = 0; i < 10 && el; i++) {
                            if (el.scrollHeight > el.clientHeight + 10) {
                                el.scrollTop += 400;
                                return;
                            }
                            el = el.parentElement;
                        }
                    }
                }
                // Method 3: Find any scrollable container in the main area
                const containers = document.querySelectorAll('main, [role="main"], .content, div');
                for (const c of containers) {
                    if (c.scrollHeight > c.clientHeight + 100 &&
                        c.clientHeight > 200 && c.clientHeight < window.innerHeight) {
                        c.scrollTop += 400;
                        return;
                    }
                }
                // Fallback: scroll window
                window.scrollBy(0, 400);
            }''')
            time.sleep(0.4)

    debug_path = os.path.join(OUTPUT_DIR, f"debug_style_{OUTPUT_PREFIX}.png")
    page.screenshot(path=debug_path)
    log(f"  Style gallery screenshot: {debug_path}")
    raise Exception(f"Cannot find style '{style_name}'")


def _upload_image(page):
    """Upload the image file to Gemini chat.
    
    Click + button → select 'Tải tệp lên' → choose file. Nothing else.
    """
    abs_path = os.path.abspath(IMAGE_PATH)
    log(f"  Absolute path: {abs_path}")

    # Dismiss any leftover overlays that could interfere
    _dismiss_dialogs(page)

    # Scroll to bottom and focus input area
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(0.3)
    _focus_input_area(page)
    time.sleep(0.3)

    # Find the '+' or upload button ONLY in the bottom input area
    add_btn = page.evaluate_handle('''() => {
        const S = window.__SEL || {};
        const vh = window.innerHeight;
        const respSel = S.response_element || 'response-element';
        const btns = document.querySelectorAll('button');
        const uploadTerms = S.upload_button_aria || ["tải tệp", "upload", "mở trình đơn"];
        for (const btn of btns) {
            if (btn.offsetParent === null) continue;
            const rect = btn.getBoundingClientRect();
            // Only consider buttons in the bottom 30% (input area)
            if (rect.top < vh * 0.70) continue;
            // Skip buttons inside overlays, dialogs, or response elements
            if (btn.closest(respSel + ', model-response, .cdk-overlay-container, [role="dialog"]')) continue;
            const aria = (btn.getAttribute("aria-label") || "").normalize("NFC").toLowerCase().trim();
            if (aria.length > 100) continue;
            if (uploadTerms.some(t => aria.includes(t))) {
                return btn;
            }
        }
        // Structural fallback: look for buttons with + or attach icon
        for (const btn of btns) {
            if (btn.offsetParent === null) continue;
            const rect = btn.getBoundingClientRect();
            if (rect.top < vh * 0.70) continue;
            // Skip buttons inside overlays, dialogs, or response elements
            if (btn.closest(respSel + ', model-response, .cdk-overlay-container, [role="dialog"]')) continue;
            const icon = btn.querySelector('mat-icon, [class*="icon"]');
            if (icon) {
                const iconText = (icon.textContent || "").trim().toLowerCase();
                if (["add", "attach_file", "upload", "add_circle"].includes(iconText)) {
                    return btn;
                }
            }
        }
        return null;
    }''')
    add_btn = add_btn.as_element()
    if add_btn:
        aria = _norm(add_btn.get_attribute("aria-label") or "")
        log(f"  Found + button in input area: '{aria}'")

    if not add_btn:
        # Last resort: try file input after a short wait
        time.sleep(0.5)
        file_inputs = page.query_selector_all('input[type="file"]')
        if file_inputs:
            log(f"  Fallback: Found {len(file_inputs)} file input(s)")
            file_inputs[-1].set_input_files(abs_path)
            if _wait_for_image_attached(page):
                log("  Image uploaded via fallback file input ✓")
                return
        _selector_fail_screenshot(page, "upload_image", "no upload button or file input found")
        raise Exception("Cannot find upload button or file input")

    add_btn.click()
    time.sleep(0.5)

    # Dismiss consent dialog if it appears
    consent_norms = [_norm(t) for t in SEL["consent_terms"]]
    for btn in page.query_selector_all('button'):
        try:
            text = _norm(btn.inner_text() or "")
            if text in consent_norms and btn.is_visible():
                log("  Dismissing consent dialog...")
                btn.click()
                time.sleep(0.3)
                add_btn.click()
                time.sleep(0.5)
                break
        except Exception:
            continue

    # Find "Tải tệp lên" or "Upload" menu item
    upload_menu_norms = [_norm(t) for t in SEL["upload_menu_terms"]]
    upload_btn = None
    for item in page.query_selector_all('[role="menuitem"], button, [role="option"]'):
        try:
            text = _norm(item.inner_text() or "")
            if any(t in text for t in upload_menu_norms) and item.is_visible():
                upload_btn = item
                log(f"  Found upload menu: '{text}'")
                break
        except Exception:
            continue

    if upload_btn:
        with page.expect_file_chooser(timeout=10000) as fc_info:
            upload_btn.click()
        fc_info.value.set_files(abs_path)
    else:
        # Close any popup that appeared, try file input
        log("  No upload menu found, closing popups and trying file input...")
        page.keyboard.press("Escape")
        time.sleep(0.3)
        file_inputs = page.query_selector_all('input[type="file"]')
        if file_inputs:
            file_inputs[-1].set_input_files(abs_path)
        else:
            raise Exception("Cannot find upload option")

    if _wait_for_image_attached(page):
        log("  Image uploaded via menu ✓")
    else:
        raise Exception("Image upload failed — thumbnail not detected in input area")


def _focus_input_area(page):
    """Click on the chat input area to ensure it's focused and file inputs are available."""
    page.evaluate('''() => {
        const S = window.__SEL || {};
        const selectors = S.focus_selectors || [
            '.ql-editor[contenteditable="true"]',
            '[contenteditable="true"]',
            'textarea'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
                el.click();
                return;
            }
        }
    }''')
    time.sleep(0.2)


def _clear_input_area(page):
    """Clear all content from the input area: text, image thumbnails, and file chips.
    
    Used before retry and between jobs to prevent accumulation of leftover content.
    Verifies that input is actually clean before returning.
    """
    for clear_attempt in range(5):
        # 1. Remove image thumbnails/chips by clicking their close/remove buttons
        removed = page.evaluate('''() => {
            const S = window.__SEL || {};
            const closeTerms = S.close_button_aria || ["remove", "xóa", "close", "delete", "đóng"];
            const bottomPx = S.input_area_bottom_px || 250;
            const vh = window.innerHeight;
            let removed = 0;
            // Find close/remove buttons on image chips in the input area
            // Build selector dynamically from config terms
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
                const rect = btn.getBoundingClientRect();
                if (rect.top <= vh - bottomPx || btn.offsetParent === null) continue;
                const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
                if (closeTerms.some(t => aria.includes(t))) {
                    try { btn.click(); removed++; } catch(e) {}
                }
            }
            // Also try clicking X buttons on chips/attachments
            const chips = document.querySelectorAll(
                '[class*="chip"] button, [class*="attachment"] button, ' +
                '[class*="upload"] button, [class*="file"] button'
            );
            for (const btn of chips) {
                const rect = btn.getBoundingClientRect();
                if (rect.top > vh - bottomPx && btn.offsetParent !== null) {
                    try { btn.click(); removed++; } catch(e) {}
                }
            }
            return removed;
        }''')
        time.sleep(0.3)

        # 2. Clear text content
        page.evaluate('''() => {
            const S = window.__SEL || {};
            const selectors = S.focus_selectors || [
                '.ql-editor[contenteditable="true"]',
                '[contenteditable="true"]',
                'textarea'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) {
                    el.focus();
                    if (el.tagName === 'TEXTAREA') {
                        el.value = '';
                    } else {
                        el.textContent = '';
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    return;
                }
            }
        }''')
        time.sleep(0.3)

        # 3. Verify input is actually clean (no images remaining)
        has_images = _count_input_images(page)
        if has_images == 0:
            log("  Input area cleared (text + attachments) ✓")
            return
        log(f"  Input area still has {has_images} image(s), retrying clear... ({clear_attempt + 1})")
        time.sleep(0.5)

    # Last resort: use keyboard to select all and delete
    page.keyboard.press("Control+a")
    time.sleep(0.1)
    page.keyboard.press("Backspace")
    time.sleep(0.3)
    log("  Input area cleared (fallback keyboard) ✓")


def _count_input_images(page):
    """Count image thumbnails currently in the chat input area (not conversation images)."""
    return page.evaluate('''() => {
        const S = window.__SEL || {};
        let count = 0;
        // Only count actual uploaded file previews — these are specific Gemini elements
        const previews = document.querySelectorAll(
            S.input_preview_selectors || 'user-query-file-preview, user-query-file-carousel'
        );
        const vh = window.innerHeight;
        for (const p of previews) {
            if (p.offsetParent === null) continue;
            const rect = p.getBoundingClientRect();
            // Only count if in the bottom input area (not in conversation history)
            if (rect.bottom > vh - 300) {
                // Count individual images inside
                const imgs = p.querySelectorAll('img');
                count += Math.max(imgs.length, 1);
            }
        }
        return count;
    }''')


def _verify_image_attached(page):
    """Check if an image thumbnail appeared in the input area."""
    # Look for image thumbnails/chips in the input area
    indicators = page.evaluate('''() => {
        // Check for image preview thumbnails near the input
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
            // Small thumbnail images near the bottom (input area)
            const rect = img.getBoundingClientRect();
            if (rect.bottom > window.innerHeight - 200 &&
                img.offsetParent !== null &&
                (img.naturalWidth > 10 || img.src.startsWith('blob:'))) {
                return "thumbnail_found";
            }
        }
        // Check for file chips/badges
        const chips = document.querySelectorAll('[class*="chip"], [class*="file"], [class*="upload"], [class*="attachment"]');
        for (const chip of chips) {
            if (chip.offsetParent !== null) return "chip_found";
        }
        return "";
    }''')
    return bool(indicators)


def _wait_for_image_attached(page, timeout=8):
    """Poll until image thumbnail appears in input area (up to timeout seconds)."""
    for i in range(timeout * 2):
        if _verify_image_attached(page):
            return True
        time.sleep(0.5)
    return False


def _enter_prompt(page):
    """Paste the FULL prompt text into the chat input via clipboard.
    
    Key insight: Gemini uses a rich text editor (Angular). Setting textContent/innerText
    directly bypasses the editor's internal model — the DOM shows the text but Gemini
    sends its internal (empty/partial) state. execCommand('insertText') breaks on newlines.
    
    The ONLY reliable approach for multiline text in a rich editor is clipboard paste:
    1. Write text to system clipboard via CDP
    2. Focus input, Ctrl+A to select all, then Ctrl+V to paste
    3. Verify the pasted text matches (both DOM and what Gemini will send)
    
    Fallback: chunked keyboard.insert_text with line-by-line Enter keys.
    """
    input_selectors = SEL.get("input_selectors", [
        '.ql-editor[contenteditable="true"]',
        '[contenteditable="true"][aria-label*="Hỏi"]',
        '[contenteditable="true"][aria-label*="prompt"]',
        '[contenteditable="true"][aria-label*="Nhập"]',
        'div[contenteditable="true"]',
        'textarea',
    ])

    input_el = None
    for sel in input_selectors:
        input_el = page.query_selector(sel)
        if input_el and input_el.is_visible():
            break
        input_el = None

    if not input_el:
        raise Exception("Cannot find prompt input field")

    input_el.click()
    time.sleep(0.1)

    tag = input_el.evaluate("el => el.tagName").lower()
    expected_len = len(PROMPT_TEXT.strip())
    log(f"  Prompt length: {expected_len} chars")

    def _clear_input():
        input_el.click()
        time.sleep(0.05)
        if tag == "textarea":
            input_el.fill("")
        else:
            # First try JS to clear content directly
            input_el.evaluate("""el => {
                el.focus();
                el.textContent = '';
                while (el.firstChild) el.removeChild(el.firstChild);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }""")
            time.sleep(0.1)
            # Then keyboard as backup
            page.keyboard.press("Control+a")
            time.sleep(0.1)
            page.keyboard.press("Backspace")
            time.sleep(0.1)
            # Double-check emptied
            remaining = input_el.evaluate("el => (el.innerText || '').trim().length")
            if remaining > 0:
                page.keyboard.press("Control+a")
                time.sleep(0.05)
                page.keyboard.press("Delete")
                time.sleep(0.1)

    def _normalize_ws(s):
        """Collapse all whitespace (newlines, spaces, tabs) into single spaces for comparison."""
        import re
        return re.sub(r'\s+', ' ', s).strip()

    def _verify_prompt():
        time.sleep(0.3)
        actual = input_el.evaluate("el => el.innerText || el.value || ''").strip()
        actual_len = len(actual)
        # Rich editors convert \n to <p> tags → innerText has extra \n.
        # Normalize whitespace for comparison: collapse all \n\n, spaces etc.
        actual_norm = _normalize_ws(actual)
        expected_norm = _normalize_ws(PROMPT_TEXT)
        # Length check on normalized text (must be close — not too short AND not too long)
        if len(actual_norm) < len(expected_norm) * 0.8:
            return False, actual_len
        if len(actual_norm) > len(expected_norm) * 1.3:
            log(f"  WARNING: input has {len(actual_norm)} chars but expected ~{len(expected_norm)} — likely duplicate text")
            return False, actual_len
        # Verify key content appears (first/last 30 chars, normalized)
        first_expected = _normalize_ws(PROMPT_TEXT[:40])
        last_expected = _normalize_ws(PROMPT_TEXT[-40:])
        if first_expected not in actual_norm[:150]:
            return False, actual_len
        if last_expected not in actual_norm[-150:]:
            return False, actual_len
        return True, actual_len

    # For textarea: use fill()
    if tag == "textarea":
        input_el.fill("")
        time.sleep(0.1)
        input_el.fill(PROMPT_TEXT)
        ok, actual_len = _verify_prompt()
        if ok:
            log(f"  Prompt entered via fill() ({actual_len} chars) ✓")
            return

    # ─── Strategy 1: Clipboard paste via CDP (most reliable) ───
    _clear_input()
    input_el.click()
    time.sleep(0.1)

    # Write to clipboard using the Clipboard API inside the page
    clipboard_ok = page.evaluate("""async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch(e) {
            return false;
        }
    }""", PROMPT_TEXT)

    if clipboard_ok:
        # Paste via Ctrl+V — this triggers the editor's paste handler correctly
        page.keyboard.press("Control+v")
        time.sleep(0.5)
        ok, actual_len = _verify_prompt()
        if ok:
            log(f"  Prompt entered via clipboard paste ({actual_len} chars) ✓")
            return
        log(f"  WARNING: clipboard paste got {actual_len}/{expected_len} chars")
    else:
        log("  WARNING: clipboard API not available, trying fallback...")

    # ─── Strategy 2: Synthetic paste event with DataTransfer ───
    _clear_input()
    input_el.click()
    time.sleep(0.1)

    paste_ok = input_el.evaluate("""(el, text) => {
        try {
            el.focus();
            // Create a synthetic paste event with the text in the clipboard data
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
            });
            const wasHandled = !el.dispatchEvent(pasteEvent);
            // If the editor handled the paste event (preventDefault was called),
            // the text should now be in the editor
            if (wasHandled) return 'paste_handled';
            // Otherwise, try execCommand as last resort for paste
            document.execCommand('insertText', false, text);
            return 'exec_fallback';
        } catch(e) {
            return null;
        }
    }""", PROMPT_TEXT)

    if paste_ok:
        ok, actual_len = _verify_prompt()
        if ok:
            log(f"  Prompt entered via synthetic paste ({paste_ok}) ({actual_len} chars) ✓")
            return
        log(f"  WARNING: synthetic paste ({paste_ok}) got {actual_len}/{expected_len} chars")

    # ─── Strategy 3: Line-by-line keyboard input ───
    # Split by newlines, type each line, press Enter between them
    _clear_input()
    input_el.click()
    time.sleep(0.1)

    lines = PROMPT_TEXT.split('\n')
    for idx, line in enumerate(lines):
        if line:  # Non-empty line: type it
            page.keyboard.insert_text(line)
            time.sleep(0.02)
        if idx < len(lines) - 1:  # Not last line: Shift+Enter for newline (Enter submits!)
            page.keyboard.press("Shift+Enter")
            time.sleep(0.01)

    ok, actual_len = _verify_prompt()
    if ok:
        log(f"  Prompt entered via line-by-line keyboard ({actual_len} chars) ✓")
        return

    log(f"  ERROR: All prompt entry methods failed! Got {actual_len}/{expected_len} chars")
    actual_text = input_el.evaluate("el => el.innerText || el.value || ''").strip()
    log(f"  Expected start: '{PROMPT_TEXT[:60]}'")
    log(f"  Actual start:   '{actual_text[:60]}'")
    log(f"  Expected end:   '{PROMPT_TEXT[-60:]}'")
    log(f"  Actual end:     '{actual_text[-60:]}'")
    raise Exception(f"Prompt entry failed: got {actual_len}/{expected_len} chars")


def _submit_prompt(page):
    """Click the send button to submit. Waits for button to be enabled and verifies submission."""
    # Wait for send button to become visible and enabled (image processing may take time)
    send_terms = [_norm(t) for t in SEL["send_aria_terms"]]
    send_btn = None
    for attempt in range(20):  # up to 10s
        for btn in page.query_selector_all('button'):
            try:
                aria = _norm(btn.get_attribute("aria-label") or "")
                if any(t in aria for t in send_terms):
                    if btn.is_visible():
                        send_btn = btn
                        break
            except Exception:
                continue
        if send_btn:
            # Check if enabled
            disabled = send_btn.get_attribute("disabled")
            aria_disabled = send_btn.get_attribute("aria-disabled")
            if disabled is None and aria_disabled != "true":
                break
            else:
                log(f"  Send button found but disabled, waiting... ({attempt * 0.5}s)")
                send_btn = None
        time.sleep(0.5)

    # Count responses BEFORE clicking so we can verify
    resp_count_before = page.evaluate("document.querySelectorAll('response-element').length")

    if send_btn:
        send_btn.click()
        log("  Clicked send button")
    else:
        log("  Send button not found/not enabled, using Enter key")
        page.keyboard.press("Enter")

    # Verify the prompt was actually submitted:
    # Wait for either (a) new response-element appears, or (b) stop button appears,
    # or (c) send button disappears/changes
    log("  Verifying submission...")
    for check in range(20):  # up to 10s
        time.sleep(0.5)

        # Check 1: New response element appeared
        new_resp_count = page.evaluate("document.querySelectorAll('response-element').length")
        if new_resp_count > resp_count_before:
            log("  Submission verified ✓ (new response element)")
            return

        # Check 2: Stop/cancel button appeared (= Gemini is processing)
        has_stop = page.evaluate('''() => {
            const S = window.__SEL || {};
            const stopTerms = S.stop_terms || ["stop", "cancel", "dừng", "hủy"];
            const stopRegex = new RegExp(stopTerms.join("|"), "i");
            const btns = document.querySelectorAll("button");
            for (const btn of btns) {
                if (btn.offsetParent === null) continue;
                const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
                const text = (btn.textContent || "").trim().toLowerCase();
                if (stopRegex.test(aria + " " + text)) return true;
            }
            return false;
        }''')
        if has_stop:
            log("  Submission verified ✓ (stop button visible)")
            return

        # Check 3: Loading/thinking indicators appear
        has_loading = page.evaluate('''() => {
            const S = window.__SEL || {};
            const thinkingSel = S.thinking_selectors || '.thinking-label, .thought-chip, [class*="thinking"]';
            const spinnerSel = S.spinner_selectors || '[role="progressbar"], .loading-indicator, .spinner';
            const main = document.querySelector('main, [role="main"]') || document.body;
            const indicators = main.querySelectorAll(thinkingSel + ', ' + spinnerSel);
            for (const el of indicators) {
                if (el.offsetParent !== null) return true;
            }
            return false;
        }''')
        if has_loading:
            log("  Submission verified ✓ (loading indicator)")
            return

        if check % 4 == 3:
            log(f"    Still waiting for submission confirmation... ({(check+1)*0.5}s)")

    # If we get here, submission may have failed — try once more with Enter
    log("  WARNING: Could not verify submission, retrying with Enter key...")
    page.keyboard.press("Enter")
    time.sleep(1)
    new_resp_count = page.evaluate("document.querySelectorAll('response-element').length")
    if new_resp_count > resp_count_before:
        log("  Submission verified ✓ (retry)")
    else:
        raise Exception("Prompt submission failed — no response after send button + Enter key")


def _check_rate_limit(page, resp_before):
    """Check if the latest response contains a rate limit message. Raises RateLimitError if so."""
    is_limited = page.evaluate('''(respBefore) => {
        const S = window.__SEL || {};
        const rlTerms = S.rate_limit_terms || [
            "can't generate more images", "cannot generate more images",
            "đạt đến giới hạn", "giới hạn tạo hình ảnh",
            "come back tomorrow", "vui lòng đợi đến"
        ];
        const respSel = S.response_element || 'response-element';
        const allResponses = document.querySelectorAll(respSel);
        for (let i = respBefore; i < allResponses.length; i++) {
            const text = (allResponses[i].innerText || "").toLowerCase();
            if (rlTerms.some(t => text.includes(t))) {
                return true;
            }
        }
        // Also check for the banner/info bar with rate limit message
        const banners = document.querySelectorAll('[class*="banner"], [class*="info"], [role="status"], [role="alert"]');
        for (const el of banners) {
            const text = (el.innerText || "").toLowerCase();
            if (rlTerms.some(t => text.includes(t))) {
                return true;
            }
        }
        return false;
    }''', resp_before)
    if is_limited:
        log("  ⚠ RATE LIMIT DETECTED — account has reached image generation limit")
        raise RateLimitError("Account rate limited by Gemini")


def _wait_for_response(page, resp_before=0):
    """Wait for Gemini to finish generating the image response.
    
    Two-phase approach:
      Phase 1: Wait for a NEW response-element to appear (= Gemini received our prompt)
      Phase 2: Wait for image to appear inside that response element
    
    Args:
        resp_before: number of response-element nodes before submitting,
                     so we only look at NEW responses.
    """
    start = time.time()
    last_log = 0

    # ── Phase 1: Wait for NEW response element to appear ──
    log("  Phase 1: Waiting for Gemini response element...")
    MAX_START_WAIT = 100
    thinking_logged = False

    while time.time() - start < MAX_START_WAIT:
        elapsed = int(time.time() - start)
        resp_count = page.evaluate("document.querySelectorAll('response-element').length")

        if resp_count > resp_before:
            log(f"  New response element appeared at {elapsed}s")
            break

        # Also check for "done" in case image appeared very fast
        status = _check_generation_status(page, resp_before)
        if status == "done":
            log(f"  Image found immediately ({elapsed}s)")
            return
        if status == "error":
            log(f"  ERROR detected at {elapsed}s")
            raise Exception("Gemini returned an error during generation")

        # Check for thinking/generating indicators OUTSIDE response-element
        # (Gemini shows "Defining Scene Details" etc. before creating response-element)
        is_thinking = page.evaluate('''() => {
            const S = window.__SEL || {};
            const stopTerms = S.stop_terms || ["stop", "cancel", "dừng", "hủy"];
            const stopRegex = new RegExp(stopTerms.join("|"), "i");
            // Check for stop button (= Gemini is processing)
            const btns = document.querySelectorAll("button");
            for (const btn of btns) {
                if (btn.offsetParent === null || btn.offsetWidth === 0) continue;
                const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
                const text = (btn.textContent || "").trim().toLowerCase();
                const title = (btn.getAttribute("title") || "").toLowerCase();
                if (stopRegex.test(aria + " " + text + " " + title)) return true;
                // Stop icon button near bottom-right
                const rect = btn.getBoundingClientRect();
                if (rect.bottom > window.innerHeight - 80 && rect.right > window.innerWidth - 200) {
                    const innerText = (btn.innerText || "").trim();
                    if (innerText.length === 0 || innerText === "■" || innerText === "□") {
                        const hasIcon = btn.querySelector('svg, mat-icon, .material-icons, [class*="icon"]');
                        if (hasIcon) return true;
                    }
                }
            }
            // Check for thinking labels
            const thinkingSel = S.thinking_selectors || '.thinking-label, .thought-chip, [class*="thinking"], [class*="thought"]';
            const thinkEls = document.querySelectorAll(thinkingSel);
            for (const el of thinkEls) {
                if (el.offsetParent !== null) return true;
            }
            return false;
        }''')
        if is_thinking:
            if not thinking_logged:
                log(f"  Gemini is thinking/generating (detected at {elapsed}s), extending wait...")
                thinking_logged = True
            # Extend Phase 1 deadline since Gemini IS processing
            MAX_START_WAIT = max(MAX_START_WAIT, elapsed + 120)

        if elapsed - last_log >= 10:
            log(f"    Waiting for response... ({elapsed}s)")
            last_log = elapsed
        time.sleep(0.5)
    else:
        raise Exception(f"No response element after {MAX_START_WAIT}s — prompt was likely not submitted")

    # ── Phase 2: Wait for IMAGE to appear in the response ──
    log("  Phase 2: Waiting for image generation to complete...")
    last_log = 0
    text_only_count = 0  # track consecutive 'text_only' checks

    while time.time() - start < MAX_WAIT_SECS:
        status = _check_generation_status(page, resp_before)
        elapsed = int(time.time() - start)

        if status == "done":
            log(f"  Generation finished — image found ({elapsed}s)")
            return

        if status == "error":
            log(f"  ERROR detected at {elapsed}s — Gemini returned an error")
            debug_path = os.path.join(OUTPUT_DIR, f"debug_error_{OUTPUT_PREFIX}.png")
            try:
                page.screenshot(path=debug_path)
            except Exception:
                pass
            raise Exception("Gemini returned an error during generation")

        if status == "text_only":
            text_only_count += 1
            # If Gemini responded with text only (no image) for 5+ consecutive checks,
            # it means generation is done but no image was produced
            if text_only_count >= 5:
                # Check if this is a rate limit message
                _check_rate_limit(page, resp_before)
                log(f"  Gemini responded with TEXT only (no image) at {elapsed}s")
                debug_path = os.path.join(OUTPUT_DIR, f"debug_textonly_{OUTPUT_PREFIX}.png")
                try:
                    page.screenshot(path=debug_path)
                except Exception:
                    pass
                raise Exception("Gemini returned text instead of generating an image")
        else:
            text_only_count = 0

        if elapsed - last_log >= 10:
            log(f"    Still generating ({status or 'waiting'})... ({elapsed}s)")
            last_log = elapsed

        time.sleep(1)

    raise Exception(f"Image generation timed out after {MAX_WAIT_SECS}s")


def _check_generation_status(page, resp_before=0):
    """Check the current state of Gemini's response generation.
    Only checks NEW response elements (index >= resp_before).
    Returns: 'done', 'generating', 'spinner', 'creating', or '' (no indicators).
    """
    return page.evaluate('''(respBefore) => {
        const S = window.__SEL || {};
        const respSel = S.response_element || 'response-element';
        const tmplSel = S.template_card || 'media-gen-template-card';
        const genImgSel = S.generated_image_selectors || 'generated-image img, .single-image img';
        const imgMinSize = S.image_min_size || 200;
        const stopTerms = S.stop_terms || ["stop", "cancel", "dừng", "hủy"];
        const stopRegex = new RegExp(stopTerms.join("|"), "i");
        const thinkingSel = S.thinking_selectors || '.thinking-label, .thought-chip, [class*="thinking"], [class*="thought"]';
        const creatingTerms = S.creating_terms || ["creating your image", "đang tạo"];
        const spinnerSel = S.spinner_selectors || '.loading-indicator, [role="progressbar"], .spinner';
        const errorSel = S.error_element_selectors || 'snack-bar, .snackbar, [role="alert"], .error-message, .mdc-snackbar';
        const errorTerms = S.error_terms || ["lỗi", "error", "failed"];
        const gallerySel = S.gallery_containers || 'media-gen-zero-state-shell, image-generation-zero-state';

        // 1. Check for generated images ONLY in NEW response elements
        const allResponses = document.querySelectorAll(respSel);
        for (let i = respBefore; i < allResponses.length; i++) {
            const resp = allResponses[i];
            const imgs = resp.querySelectorAll('img');
            for (const img of imgs) {
                if (img.naturalWidth > imgMinSize && img.offsetParent !== null) {
                    return "done";
                }
            }
            const canvases = resp.querySelectorAll('canvas');
            for (const cv of canvases) {
                if (cv.width > imgMinSize && cv.offsetParent !== null) {
                    return "done";
                }
            }
        }
        // Also check generated-image / single-image NOT inside old responses
        const genImgs = document.querySelectorAll(genImgSel);
        for (const img of genImgs) {
            if (img.naturalWidth < imgMinSize || img.offsetParent === null) continue;
            if (img.closest(tmplSel)) continue;
            const parentResp = img.closest(respSel);
            if (parentResp) {
                const idx = Array.from(allResponses).indexOf(parentResp);
                if (idx >= respBefore) return "done";
            }
        }

        // 2. Check if a new response-element exists but has no image yet
        //    Distinguish between: still generating vs text-only response (done but no image)
        if (allResponses.length > respBefore) {
            const newResp = allResponses[allResponses.length - 1];
            const hasLargeImg = Array.from(newResp.querySelectorAll('img'))
                .some(img => img.naturalWidth > imgMinSize && img.offsetParent !== null);
            if (!hasLargeImg) {
                // Check if response is complete (has substantial text, no loading indicators)
                const respText = (newResp.innerText || "").trim();
                const hasStopBtn = !!document.querySelector('button[aria-label*="top"], button[aria-label*="ừng"]');
                const hasSpinner = !!newResp.querySelector(spinnerSel);
                const hasThinking = !!newResp.querySelector(thinkingSel);
                if (respText.length > 50 && !hasStopBtn && !hasSpinner && !hasThinking) {
                    // Response has text but no image and no loading = text-only response
                    return "text_only";
                }
                return "generating";
            }
        }

        // 3. Check for stop/cancel button — including icon-only buttons
        const btns = document.querySelectorAll("button");
        for (const btn of btns) {
            if (btn.offsetParent === null || btn.offsetWidth === 0) continue;
            const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
            const text = (btn.textContent || "").trim().toLowerCase();
            const title = (btn.getAttribute("title") || "").toLowerCase();
            const combined = aria + " " + text + " " + title;
            // Check text/aria for stop/cancel keywords
            if (stopRegex.test(combined)) {
                return "generating";
            }
            // Check for the square stop icon button near the bottom/input area
            // It replaces the send button and typically has a small rect/square shape
            const rect = btn.getBoundingClientRect();
            if (rect.bottom > window.innerHeight - 80 && rect.right > window.innerWidth - 200) {
                // Button in bottom-right area (where send button normally is)
                // If it has a very short text or no text, it's likely the stop icon
                const innerText = (btn.innerText || "").trim();
                if (innerText.length === 0 || innerText === "■" || innerText === "□") {
                    // Check if it has an SVG or icon child (common for stop buttons)
                    const hasIcon = btn.querySelector('svg, mat-icon, .material-icons, [class*="icon"]');
                    if (hasIcon) return "generating";
                }
            }
        }

        // 4. Check for thinking/reasoning indicators in the MAIN chat area only
        //    (NOT the sidebar which has old conversation titles)
        const mainArea = document.querySelector('main, .conversation-container, [role="main"]') || document.body;
        const thinkingElements = mainArea.querySelectorAll(thinkingSel);
        for (const el of thinkingElements) {
            if (el.offsetParent !== null) return "creating";
        }

        // 5. Check loading text in NEW response elements only (NOT sidebar/body)
        for (let i = respBefore; i < allResponses.length; i++) {
            const respText = allResponses[i].innerText || "";
            if (creatingTerms.some(t => respText.toLowerCase().includes(t))) {
                return "creating";
            }
        }
        // Also check the input/prompt area for "Generating" indicator
        const inputArea = document.querySelector('.input-area, .chat-input, .prompt-area');
        if (inputArea) {
            const inputText = inputArea.innerText || "";
            if (inputText.includes("Generating") || inputText.includes("Creating")) {
                return "creating";
            }
        }

        // 6. Check loading spinners / animated elements — be specific
        //    Only match actual loading indicators, not random elements
        const spinners = document.querySelectorAll(spinnerSel);
        for (const s of spinners) {
            if (s.offsetParent !== null) return "spinner";
        }

        // 7. Check for error messages (Gemini may show "Đã xảy ra lỗi")
        const snackbars = document.querySelectorAll(errorSel);
        for (const el of snackbars) {
            const text = (el.innerText || "").toLowerCase();
            if (errorTerms.some(t => text.includes(t))) {
                return "error";
            }
        }
        // Also check if the style gallery reappeared (means generation failed)
        const styleGallery = document.querySelector(gallerySel);
        if (styleGallery && styleGallery.offsetParent !== null && allResponses.length > respBefore) {
            // Style gallery visible BUT a response was created = error/fallback
            return "error";
        }

        return "";
    }''', resp_before)


def _download_via_button(page, resp_before=0):
    """
    Download the generated image by hovering over it and clicking
    the download button — gives the best quality output.
    Only looks at NEW response elements (index >= resp_before).
    """
    # Dismiss any overlays (image expansion, share dialog, etc.) before searching
    _dismiss_dialogs(page)
    # Scroll to bottom to make sure the generated image is visible
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(0.5)

    # Debug: log all large images with their parent chain
    debug_info = page.evaluate('''() => {
        const allImgs = document.querySelectorAll('img');
        const info = [];
        for (const img of allImgs) {
            if (img.naturalWidth < 100 || img.naturalHeight < 100) continue;
            const parents = [];
            let p = img.parentElement;
            let depth = 0;
            while (p && depth < 6) {
                parents.push(p.tagName.toLowerCase());
                p = p.parentElement;
                depth++;
            }
            info.push({
                src: img.src.substring(0, 80),
                w: img.naturalWidth,
                h: img.naturalHeight,
                visible: img.offsetParent !== null,
                y: Math.round(img.getBoundingClientRect().top),
                inTemplate: !!img.closest(window.__SEL?.template_card || 'media-gen-template-card'),
                inResponse: !!img.closest((window.__SEL?.response_element || 'response-element') + ', model-response, .response-container'),
                inUserMsg: !!img.closest(window.__SEL?.user_msg_selectors || 'user-query, .user-message, .query-content'),
                parents: parents.join(' < ')
            });
        }
        return info;
    }''')

    for item in debug_info:
        log(f"  IMG: {item['w']}x{item['h']} vis={item['visible']} y={item['y']} "
            f"tpl={item['inTemplate']} resp={item['inResponse']} user={item['inUserMsg']} "
            f"parents=[{item['parents']}] src={item['src']}")

    # Find generated images — ONLY in NEW response elements
    target_img = page.evaluate_handle('''(respBefore) => {
        const S = window.__SEL || {};
        const respSel = S.response_element || 'response-element';
        const tmplSel = S.template_card || 'media-gen-template-card';
        const genImgSel = S.generated_image_selectors || 'generated-image img, .single-image img, .image-card img';
        const userMsgSel = S.user_msg_selectors || 'user-query, .user-message';
        const imgMinSize = S.image_min_size || 200;
        const allResponses = document.querySelectorAll(respSel);
        
        // Priority 1: Images in NEW response-element containers only
        const responseCandidates = [];
        for (let i = respBefore; i < allResponses.length; i++) {
            const container = allResponses[i];
            const imgs = container.querySelectorAll('img');
            for (const img of imgs) {
                if (img.naturalWidth < imgMinSize || img.naturalHeight < imgMinSize) continue;
                if (img.offsetParent === null) continue;
                if (img.closest(tmplSel)) continue;
                responseCandidates.push(img);
            }
        }
        if (responseCandidates.length > 0) {
            return responseCandidates[responseCandidates.length - 1];
        }

        // Priority 2: generated-image/single-image inside NEW responses
        const genImgs = document.querySelectorAll(genImgSel);
        for (const img of Array.from(genImgs).reverse()) {
            if (img.naturalWidth < imgMinSize && img.naturalHeight < imgMinSize) continue;
            if (img.offsetParent === null) continue;
            if (img.closest(tmplSel)) continue;
            const parentResp = img.closest(respSel);
            if (parentResp) {
                const idx = Array.from(allResponses).indexOf(parentResp);
                if (idx >= respBefore) return img;
            }
        }

        // Priority 3: Fallback — large images in NEW responses, skip user msgs
        for (let i = respBefore; i < allResponses.length; i++) {
            const container = allResponses[i];
            const imgs = container.querySelectorAll('img');
            for (const img of Array.from(imgs).reverse()) {
                if (img.naturalWidth < imgMinSize || img.naturalHeight < imgMinSize) continue;
                if (img.offsetParent === null) continue;
                if (img.closest(tmplSel)) continue;
                if (img.closest(userMsgSel)) continue;
                return img;
            }
        }
        return null;
    }''', resp_before)

    if not target_img.as_element():
        # Images may still be loading — wait and retry up to 3 times
        for retry in range(3):
            log(f"  No image found yet, waiting 3s... (retry {retry+1}/3)")
            time.sleep(3)
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(0.5)
            target_img = page.evaluate_handle('''(respBefore) => {
                const S = window.__SEL || {};
                const respSel = S.response_element || 'response-element';
                const tmplSel = S.template_card || 'media-gen-template-card';
                const userMsgSel = S.user_msg_selectors || 'user-query, .user-message';
                const imgMinSize = S.image_min_size || 200;
                const allResponses = document.querySelectorAll(respSel);
                for (let i = respBefore; i < allResponses.length; i++) {
                    const container = allResponses[i];
                    const imgs = container.querySelectorAll('img');
                    for (const img of Array.from(imgs).reverse()) {
                        if (img.naturalWidth < imgMinSize || img.naturalHeight < imgMinSize) continue;
                        if (img.offsetParent === null) continue;
                        if (img.closest(tmplSel)) continue;
                        if (img.closest(userMsgSel)) continue;
                        return img;
                    }
                }
                return null;
            }''', resp_before)
            if target_img.as_element():
                break

    if not target_img.as_element():
        # Take a full-page screenshot for debugging
        debug_path = os.path.join(OUTPUT_DIR, f"debug_no_img_{OUTPUT_PREFIX}.png")
        page.screenshot(path=debug_path, full_page=True)
        log(f"  Full-page debug screenshot: {debug_path}")
        raise Exception("No generated image found outside style template cards")

    target_img = target_img.as_element()
    src = (target_img.get_attribute("src") or "")[:80]
    bbox = target_img.bounding_box()
    log(f"  Found generated image: src={src}..." + (f" pos=({bbox['x']:.0f},{bbox['y']:.0f})" if bbox else ""))

    # ── Method 1: Direct blob/src fetch BEFORE opening editor ──
    # This is the most reliable — fetch the image data while we're still in chat view
    try:
        result = _download_direct_fetch(page, target_img)
        if result:
            return result
    except Exception as e:
        log(f"  Direct fetch failed: {e}")

    # ── Method 2: Canvas capture (also before editor, avoids stale refs) ──
    try:
        result = _download_via_canvas(page, target_img)
        if result:
            return result
    except Exception as e:
        log(f"  Canvas capture failed: {e}")

    raise Exception("All download methods failed")


def _download_direct_fetch(page, target_img):
    """Method 1: Fetch the image blob/src directly via JS fetch() — no editor needed."""
    import base64

    src = target_img.get_attribute("src") or ""
    log(f"  Method 1: Direct fetch (src={src[:60]}...)")

    if not (src.startswith("blob:") or src.startswith("http") or src.startswith("data:")):
        log(f"  Unsupported src type: {src[:30]}")
        return None

    if src.startswith("data:"):
        import re
        match = re.match(r"data:([^;]+);base64,(.+)", src)
        if not match:
            return None
        mime = match.group(1)
        img_data = base64.b64decode(match.group(2))
    else:
        # Fetch blob or http URL via page context
        data_url = page.evaluate("""(src) => {
            return fetch(src)
                .then(resp => resp.blob())
                .then(blob => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => reject('read error');
                    reader.readAsDataURL(blob);
                }))
                .catch(() => null);
        }""", src)

        if not data_url or "base64," not in data_url:
            log("  Direct fetch returned no data")
            return None

        mime = data_url.split(";")[0].split(":")[1] if ":" in data_url else "image/png"
        b64 = data_url.split("base64,")[1]
        img_data = base64.b64decode(b64)

    if len(img_data) < 1000:
        log(f"  Direct fetch data too small ({len(img_data)} bytes)")
        return None

    ext_map = {"image/jpeg": ".jpg", "image/jfif": ".jfif", "image/webp": ".webp", "image/png": ".png"}
    ext = ext_map.get(mime, ".png")
    output_filename = f"{OUTPUT_PREFIX}{ext}"
    output_path = os.path.join(OUTPUT_DIR, output_filename)

    with open(output_path, "wb") as f:
        f.write(img_data)
    log(f"  Method 1 OK: {output_filename} ({len(img_data)} bytes, {mime})")
    return output_filename


def _download_via_canvas(page, target_img):
    """Method 2: Draw image to canvas, export as PNG base64."""
    import base64

    log("  Method 2: Canvas capture")

    data_url = target_img.evaluate("""(img) => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
        } catch(e) {
            return null;
        }
    }""")

    if not data_url or "base64," not in data_url:
        log("  Canvas toDataURL failed (likely CORS)")
        return None

    b64 = data_url.split("base64,")[1]
    img_data = base64.b64decode(b64)

    if len(img_data) < 1000:
        log(f"  Canvas data too small ({len(img_data)} bytes)")
        return None

    output_filename = f"{OUTPUT_PREFIX}.png"
    output_path = os.path.join(OUTPUT_DIR, output_filename)

    with open(output_path, "wb") as f:
        f.write(img_data)
    log(f"  Method 2 OK: {output_filename} ({len(img_data)} bytes)")
    return output_filename


if __name__ == "__main__":
    main()
