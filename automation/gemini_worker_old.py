"""
gemini_worker.py — Playwright automation for Gemini image generation.

Environment variables (passed by jobRunner.js):
  COOKIE_DIR    — path to persistent browser context cookies
  IMAGE_PATH    — path to input image
  PROMPT_TEXT   — prompt to send to Gemini
  OUTPUT_PREFIX — prefix for output filename (e.g. mockup_1, line_1)

Prints the output filename to stdout on success.
"""

import os
import sys
import time
import glob
import base64
import re
import unicodedata
import urllib.request

COOKIE_DIR = os.environ.get("COOKIE_DIR", "")
IMAGE_PATH = os.environ.get("IMAGE_PATH", "")
PROMPT_TEXT = os.environ.get("PROMPT_TEXT", "")
OUTPUT_PREFIX = os.environ.get("OUTPUT_PREFIX", "output")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs")

GEMINI_URL = "https://gemini.google.com/app"
MAX_WAIT_SECS = 240  # max wait for Gemini response (image gen can take 2-4 min)


def log(msg):
    print(f"[gemini_worker] {msg}", file=sys.stderr)


def main():
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
        log("ERROR: Playwright not installed. Run: pip install playwright && playwright install")
        sys.exit(1)

    log(f"Starting automation...")
    log(f"  COOKIE_DIR={COOKIE_DIR}")
    log(f"  IMAGE_PATH={IMAGE_PATH}")
    log(f"  PROMPT_TEXT={PROMPT_TEXT[:80]}...")
    log(f"  OUTPUT_PREFIX={OUTPUT_PREFIX}")

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=COOKIE_DIR,
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )

        page = browser.new_page()

        try:
            # 1. Navigate to Gemini
            log("Navigating to Gemini...")
            page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_load_state("load", timeout=15000)
            time.sleep(3)

            # Check if we need to login
            if "accounts.google.com" in page.url or "signin" in page.url:
                log("ERROR: Not logged in — session expired")
                browser.close()
                sys.exit(1)

            # Dismiss any initial dialogs/popups
            _dismiss_dialogs(page)

            # 2. Upload image via file chooser
            log("Uploading image...")
            _upload_image(page)

            # 3. Enter prompt text
            log("Entering prompt...")
            _enter_prompt(page)

            # 4. Submit (press Enter or click send)
            log("Submitting prompt...")
            _submit_prompt(page)

            # 5. Wait for response with image
            log("Waiting for Gemini response...")
            _wait_for_response(page)

            # 6. Download the generated image
            log("Downloading result image...")
            output_filename = _download_result_image(page)

            log(f"SUCCESS: {output_filename}")
            # Print filename to stdout (jobRunner reads this)
            print(output_filename)

        except Exception as e:
            log(f"ERROR: {e}")
            # Save screenshot for debugging
            try:
                debug_path = os.path.join(OUTPUT_DIR, f"debug_{OUTPUT_PREFIX}.png")
                page.screenshot(path=debug_path)
                log(f"Debug screenshot saved: {debug_path}")
            except Exception:
                pass
            browser.close()
            sys.exit(1)

        browser.close()


def _dismiss_dialogs(page):
    """Close any cookie consent or welcome dialogs."""
    try:
        # Common dismiss buttons
        for selector in [
            'button:has-text("Got it")',
            'button:has-text("Dismiss")',
            'button:has-text("OK")',
            'button:has-text("No thanks")',
            'button:has-text("Skip")',
            'button:has-text("Đồng ý")',
        ]:
            btn = page.query_selector(selector)
            if btn and btn.is_visible():
                btn.click()
                time.sleep(0.5)
    except Exception:
        pass


def _upload_image(page):
    """Upload the image file to Gemini chat."""
    # Click the "+" button to open file upload menu
    # The button has aria-label "Mở trình đơn tải tệp lên" in Vietnamese Gemini
    # Use unicodedata.normalize to handle NFC/NFD differences with Vietnamese diacritics
    def _norm(s):
        return unicodedata.normalize('NFC', s).lower()

    search_terms = [_norm("tải tệp"), _norm("upload")]
    
    add_btn = None
    all_btns = page.query_selector_all('button')
    for btn in all_btns:
        try:
            aria = _norm(btn.get_attribute("aria-label") or "")
            # Skip sidebar conversation "more options" buttons (very long aria-labels)
            if len(aria) > 100:
                continue
            if any(term in aria for term in search_terms) and btn.is_visible():
                add_btn = btn
                log(f"Found upload button: aria='{aria}'")
                break
        except Exception:
            continue
    
    is_valid = add_btn is not None

    if is_valid:
        add_btn.click()
        time.sleep(1.5)
        
        # Check for consent dialog ("Tạo nội dung từ hình ảnh và tệp" / "Đồng ý")
        consent_terms = [_norm("đồng ý"), _norm("agree"), _norm("i agree")]
        consent_btn = None
        for btn in page.query_selector_all('button'):
            try:
                text = _norm(btn.inner_text() or "").strip()
                if any(t == text for t in consent_terms) and btn.is_visible():
                    consent_btn = btn
                    break
            except Exception:
                continue
        if consent_btn:
            log("Dismissing consent dialog...")
            consent_btn.click()
            time.sleep(1.5)
            # Re-click the + button after consent
            add_btn.click()
            time.sleep(1.5)
        
        # After clicking "+", look for "Upload file" / "Tải tệp lên" option in menu
        upload_btn = None
        menu_items = page.query_selector_all('button, [role="menuitem"], [role="option"], a, li')
        for item in menu_items:
            try:
                text = _norm(item.inner_text() or "").strip()
                if ("tải tệp" in text or "upload file" in text or text == "upload") and item.is_visible():
                    upload_btn = item
                    log(f"Found upload menu item: '{text}'")
                    break
            except Exception:
                continue
        
        if upload_btn:
            # Use file chooser expectation
            with page.expect_file_chooser(timeout=10000) as fc_info:
                upload_btn.click()
            file_chooser = fc_info.value
            file_chooser.set_files(IMAGE_PATH)
        else:
            # Maybe clicking "+" directly opens file chooser
            # Try input[type=file] which might have appeared
            file_input = page.query_selector('input[type="file"]')
            if file_input:
                file_input.set_input_files(IMAGE_PATH)
            else:
                raise Exception("Cannot find upload option after clicking + button")
    else:
        # Try direct input[type=file] (hidden file input)
        file_input = page.query_selector('input[type="file"]')
        if file_input:
            file_input.set_input_files(IMAGE_PATH)
        else:
            raise Exception("Cannot find + button or file input")

    # Wait for image to be attached (thumbnail should appear)
    time.sleep(4)
    
    # Verify image attachment by checking for thumbnail
    thumbnail = page.query_selector('img[alt*="upload"], img[alt*="tải"], .image-chip, [data-file-name]')
    if thumbnail:
        log("Image uploaded/attached (thumbnail confirmed)")
    else:
        # Take a debug screenshot to see what happened
        debug_path = os.path.join(OUTPUT_DIR, f"debug_upload_{OUTPUT_PREFIX}.png")
        page.screenshot(path=debug_path)
        log(f"Image upload uncertain - screenshot saved: {debug_path}")
        log("Image uploaded/attached (thumbnail not found, continuing anyway)")


def _enter_prompt(page):
    """Type the prompt text into the chat input."""
    input_selectors = [
        '.ql-editor[contenteditable="true"]',
        '[contenteditable="true"][aria-label*="prompt"]',
        '[contenteditable="true"][aria-label*="Prompt"]',
        '[contenteditable="true"][aria-label*="Hỏi"]',
        '[contenteditable="true"][aria-label*="Enter"]',
        '[contenteditable="true"][aria-label*="Nhập"]',
        'div[contenteditable="true"]',
        'rich-textarea [contenteditable="true"]',
        'p[data-placeholder]',
        'textarea',
    ]

    input_el = None
    for sel in input_selectors:
        input_el = page.query_selector(sel)
        if input_el and input_el.is_visible():
            break
        input_el = None

    if not input_el:
        raise Exception("Cannot find prompt input field")

    input_el.click()
    time.sleep(0.3)

    # Use insertText or line-by-line with Shift+Enter to avoid
    # keyboard.type() sending Enter for newlines (which submits the message)
    tag = input_el.evaluate("el => el.tagName").lower()
    if tag == "textarea":
        input_el.fill(PROMPT_TEXT)
    else:
        # contenteditable — type line by line, Shift+Enter for newlines
        lines = PROMPT_TEXT.split('\n')
        for i, line in enumerate(lines):
            if line.strip():
                page.keyboard.type(line, delay=5)
            if i < len(lines) - 1:
                page.keyboard.press("Shift+Enter")

    time.sleep(0.5)
    log("Prompt entered")


def _submit_prompt(page):
    """Click the send button or press Enter to submit."""
    def _norm(s):
        return unicodedata.normalize('NFC', s).lower()

    # Use NFC normalization for Vietnamese aria-labels
    send_btn = None
    all_btns = page.query_selector_all('button')
    for btn in all_btns:
        try:
            aria = _norm(btn.get_attribute("aria-label") or "")
            if any(term in aria for term in ["send", "gửi", "submit"]):
                if btn.is_visible() and btn.is_enabled():
                    send_btn = btn
                    break
        except Exception:
            continue

    if send_btn:
        send_btn.click()
    else:
        # Fallback: press Enter
        page.keyboard.press("Enter")

    time.sleep(2)
    log("Prompt submitted")


def _wait_for_response(page):
    """Wait for Gemini to finish generating a response."""
    def _norm(s):
        return unicodedata.normalize('NFC', s).lower()

    start = time.time()
    
    # Phase 1: Wait for response to START (at least wait a few seconds)
    log("  Waiting for response to start...")
    time.sleep(5)
    
    # Phase 2: Wait for response to FINISH
    # Gemini shows "Đang tải" (Loading) text and a stop button during generation
    log("  Waiting for response to finish...")
    stable_count = 0
    
    while time.time() - start < MAX_WAIT_SECS:
        is_generating = False
        
        # Check 1: Use JavaScript to detect generation state
        # During generation: microphone button is hidden/replaced by stop button
        # Also check for loading text patterns
        is_loading_js = page.evaluate('''() => {
            // Method A: Check if microphone button is visible
            // During generation, mic is replaced by stop button
            let micFound = false;
            let micVisible = false;
            const btns = document.querySelectorAll("button");
            for (const btn of btns) {
                const aria = btn.getAttribute("aria-label") || "";
                // "icr" matches both "Micrô" (Vietnamese) and "Microphone" (English)  
                if (aria.includes("icr")) {
                    micFound = true;
                    micVisible = btn.offsetParent !== null && btn.offsetWidth > 0;
                    break;
                }
            }
            // If mic button exists but is NOT visible, generation is in progress
            if (micFound && !micVisible) return "mic_hidden";
            
            // Method B: Check for loading text patterns
            const text = document.body.innerText || "";
            const patterns = [
                "ang tải",
                "Loading", "Generating", "Developing", "Constructing",
                "Creating", "Processing", "Thinking", "Rendering",
                "Building", "Composing", "Designing", "Analyzing",
            ];
            for (const p of patterns) {
                if (text.includes(p)) return "text:" + p;
            }
            
            return "";
        }''')
        
        if is_loading_js:
            is_generating = True
            elapsed = int(time.time() - start)
            if elapsed % 10 == 0:
                log(f"    Still generating ({is_loading_js})... ({elapsed}s)")
        
        # Check 2: Look for stop/cancel button via Python with NFC normalization
        if not is_generating:
            all_btns = page.query_selector_all('button')
            for btn in all_btns:
                try:
                    aria = _norm(btn.get_attribute("aria-label") or "")
                    if any(term in aria for term in ["stop", "cancel", "dừng", "hủy"]):
                        if btn.is_visible():
                            is_generating = True
                            break
                except Exception:
                    continue
        
        if is_generating:
            stable_count = 0
            time.sleep(3)
            elapsed = int(time.time() - start)
            if elapsed % 15 == 0:
                log(f"    Still generating... ({elapsed}s)")
            continue
        
        # Not generating — check stability
        stable_count += 1
        if stable_count >= 3:
            log(f"  Response finished ({int(time.time() - start)}s)")
            # Extra wait for images to fully render
            time.sleep(3)
            return
        
        time.sleep(2)
    
    # If we reached timeout but content exists, continue anyway
    log(f"  Timeout after {MAX_WAIT_SECS}s, proceeding with what's available")


def _find_response_images(page):
    """Find generated images in the Gemini response (not the uploaded input)."""
    # Find ALL images, then pick the best candidate
    all_imgs = page.query_selector_all("img")
    candidates = []
    
    for i, img in enumerate(all_imgs):
        try:
            src = img.get_attribute("src") or ""
            alt = img.get_attribute("alt") or ""
            width = img.evaluate("el => el.naturalWidth") or 0
            height = img.evaluate("el => el.naturalHeight") or 0
            visible = img.is_visible()
            
            if width > 100 and height > 100 and visible:
                candidates.append({
                    "el": img,
                    "width": width,
                    "height": height,
                    "src": src,
                    "alt": alt,
                })
        except Exception:
            continue

    if not candidates:
        log("  No candidate images found")
        return []

    # Filter out the uploaded input image:
    # The uploaded image will be smaller (thumbnail) or in the user message area
    # Generated images are typically larger and appear later in the DOM
    # If there are multiple candidates, skip the first one (likely uploaded image)
    if len(candidates) > 1:
        # Return all except the first (uploaded) image
        return [c["el"] for c in candidates[1:]]
    elif len(candidates) == 1:
        # Only one image — could be the uploaded one or the generated one
        # If it's very small, probably the thumbnail
        c = candidates[0]
        if c["width"] >= 400 and c["height"] >= 400:
            return [c["el"]]
        else:
            log(f"  Single image too small ({c['width']}x{c['height']}), likely thumbnail")
            return []
    
    return []


def _download_result_image(page):
    """Download the last generated image from the response."""
    images = _find_response_images(page)
    if not images:
        raise Exception("No generated image found in response")

    # Take the last image (most likely the final result)
    target_img = images[-1]
    src = target_img.get_attribute("src") or ""

    output_filename = f"{OUTPUT_PREFIX}.png"
    output_path = os.path.join(OUTPUT_DIR, output_filename)

    if src.startswith("data:"):
        # Data URL — decode base64
        match = re.match(r"data:[^;]+;base64,(.+)", src)
        if match:
            img_data = base64.b64decode(match.group(1))
            with open(output_path, "wb") as f:
                f.write(img_data)
        else:
            raise Exception("Cannot parse data URL")

    elif src.startswith("blob:"):
        # Blob URL — fetch raw binary directly (no canvas re-encoding)
        img_b64 = target_img.evaluate("""async (img) => {
            const resp = await fetch(img.src);
            const blob = await resp.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        }""")
        if img_b64 and "base64," in img_b64:
            # Detect original format from MIME type (e.g. data:image/png;base64,...)
            mime = img_b64.split(";")[0].split(":")[1] if ":" in img_b64 else "image/png"
            b64 = img_b64.split("base64,")[1]
            img_data = base64.b64decode(b64)

            # Use correct extension based on original MIME
            ext_map = {"image/jpeg": ".jpg", "image/webp": ".webp", "image/png": ".png"}
            ext = ext_map.get(mime, ".png")
            output_filename = f"{OUTPUT_PREFIX}{ext}"
            output_path = os.path.join(OUTPUT_DIR, output_filename)

            with open(output_path, "wb") as f:
                f.write(img_data)
            log(f"Blob fetched as {mime} ({len(img_data)} bytes)")
        else:
            raise Exception("Cannot fetch blob URL")

    elif src.startswith("http"):
        # Regular URL — download it
        # Try using page context first (cookies needed)
        img_bytes = target_img.evaluate("""async (img) => {
            const resp = await fetch(img.src);
            const blob = await resp.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        }""")
        if img_bytes and "base64," in img_bytes:
            b64 = img_bytes.split("base64,")[1]
            with open(output_path, "wb") as f:
                f.write(base64.b64decode(b64))
        else:
            # Simple download
            urllib.request.urlretrieve(src, output_path)
    else:
        raise Exception(f"Unknown image src format: {src[:100]}")

    # Verify file was created and has content
    if not os.path.isfile(output_path) or os.path.getsize(output_path) < 1000:
        raise Exception(f"Output file too small or missing: {output_path}")

    log(f"Image saved: {output_path} ({os.path.getsize(output_path)} bytes)")
    return output_filename


if __name__ == "__main__":
    main()
