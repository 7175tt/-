"""Synthetic camera quality and lifecycle regression; no server/accounts needed.

Run: python3 tests/browser-camera-quality.py
Requires installed npm dependencies, Python Playwright and system Chromium.
The test bundles a temporary fixture and uses Chromium's fake video device.
It does not access a physical camera or make external requests.
"""

import json
import os
import subprocess
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    checks = []

    def passed(label):
        checks.append(label)
        print(f"PASS {label}", flush=True)

    with tempfile.TemporaryDirectory(prefix="card-camera-quality-") as temporary:
        directory = Path(temporary)
        subprocess.run([str(ROOT / "node_modules/.bin/esbuild"), "tests/fixtures/cardScannerQuality.tsx", "--bundle", "--format=iife", f"--outfile={directory / 'fixture.js'}"], cwd=ROOT, check=True)
        subprocess.run([str(ROOT / "node_modules/.bin/tailwindcss"), "-i", "index.css", "-o", str(directory / "style.css"), "--minify"], cwd=ROOT, check=True)
        (directory / "index.html").write_text('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
                page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_address[1]}")
                capture = page.get_by_role("button", name="拍攝新名片")

                def reset(behavior="photo", still=True, width=640, height=480):
                    page.evaluate("([behavior, still, width, height]) => { window.behavior = behavior; window.useStillCamera(still); window.previewWidth=width; window.previewHeight=height; window.captures=[]; window.stillCalls=[]; window.showScanner(); }", [behavior, still, width, height])
                    expect(capture).to_be_enabled()

                def photo():
                    capture.click()
                    page.wait_for_function("window.captures.length === 1")
                    return page.evaluate("window.inspectLastImage()")

                expect(capture).to_be_enabled()
                capture.evaluate("button => { button.click(); button.click(); button.click(); }")
                page.wait_for_function("window.captures.length === 1")
                result = page.evaluate("window.inspectLastImage()")
                assert (result["width"], result["height"]) == (3200, 2400), result
                assert result["bytes"] <= 3 * 1024 * 1024
                assert page.evaluate("window.stillCalls") == [{"imageWidth": 4032, "imageHeight": 3024}]
                for corner, color in [("topLeft", [255, 0, 0]), ("topRight", [0, 255, 0]), ("bottomLeft", [0, 0, 255]), ("bottomRight", [255, 255, 0])]:
                    assert all(abs(a - b) < 20 for a, b in zip(result[corner], color)), (corner, result)
                passed("640×480 preview produces a real 3200×2400 still; full-frame corners retained and triple click saves once")

                reset("rotated")
                result = photo()
                assert (result["width"], result["height"]) == (2400, 3200), result
                assert result["topLeft"][2] > 230 and result["topRight"][0] > 230, result
                passed("EXIF portrait orientation remains correct without clipping the differently shaped still")

                reset(still=False, width=1920, height=1080)
                result = photo()
                assert (result["width"], result["height"]) == (1530, 972), result
                expect(page.get_by_text("預覽畫面拍照 · 手機相機可保留更多細節", exact=True)).to_be_visible()
                passed("no still API uses a full-width preview fallback at 1530×972, without enlarging a center crop")

                reset("unsupported")
                result = photo()
                assert result["width"] == 576 and result["height"] == 366, result
                expect(page.get_by_role("alert")).to_contain_text("這次使用預覽畫面")
                assert len(page.evaluate("window.stillCalls")) == 2
                passed("unsupported still settings and default still fall back explicitly; small video images are never upscaled")

                reset("error")
                capture.click()
                expect(page.get_by_role("alert")).to_contain_text("高畫質拍攝未成功")
                expect(capture).to_be_enabled()
                assert page.evaluate("window.captures.length") == 0
                assert len(page.evaluate("window.stillCalls")) == 1
                page.evaluate("window.behavior='photo'")
                photo()
                passed("temporary still-camera failures save no low-resolution substitute and allow retry")

                reset("pending-photo")
                capture.click()
                page.wait_for_function("window.pendingPhotos.length === 1")
                page.evaluate("window.hideScanner()")
                expect(page.locator("video")).to_have_count(0)
                assert page.evaluate("window.lastStream.getTracks().every(track => track.readyState === 'ended')")
                page.evaluate("window.showScanner()")
                expect(capture).to_be_enabled()
                capture.click()
                page.wait_for_function("window.pendingPhotos.length === 2")
                page.evaluate("async () => window.pendingPhotos[0](await window.makePhoto())")
                expect(capture).to_be_disabled()
                assert page.evaluate("window.captures.length") == 0
                page.evaluate("async () => window.pendingPhotos[1](await window.makePhoto())")
                page.wait_for_function("window.captures.length === 1")
                passed("late photo after unmount is discarded and cannot unlock or overwrite a newer capture")

                reset("pending-capabilities")
                page.clock.install()
                capture.click()
                page.wait_for_function("window.pendingCapabilities.length === 1")
                page.clock.fast_forward(12001)
                expect(page.get_by_role("alert")).to_contain_text("高畫質拍攝未成功")
                expect(capture).to_be_enabled()
                page.evaluate("window.pendingCapabilities[0]({})")
                assert page.evaluate("window.stillCalls.length") == 0
                assert page.evaluate("window.captures.length") == 0
                passed("hung capability query times out, unlocks controls and never starts a late photograph")

                page.evaluate("""() => {
                  window.behavior='photo';
                  window.forceUnready=true;
                  const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
                  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable:true,
                    get() { return window.forceUnready ? 1 : descriptor.get.call(this); }
                  });
                  window.showScanner();
                }""")
                page.wait_for_function("document.querySelector('video')?.videoWidth > 0")
                page.clock.fast_forward(350)
                expect(capture).to_be_disabled()
                page.evaluate("window.forceUnready=false; document.querySelector('video').dispatchEvent(new Event('canplay'))")
                expect(capture).to_be_enabled()
                passed("frames that arrive after initial settling still enable the shutter")

                reset("noise")
                result = photo()
                assert result["bytes"] <= 3 * 1024 * 1024, result
                assert result["width"] <= 3200 and result["height"] <= 2400, result
                passed("high-detail noisy photos stay within 3 MB while retaining aspect ratio")

                expect(capture).to_be_enabled()
                page.get_by_role("button", name="完成（1）").click()
                assert page.evaluate("window.lastStream.getTracks().every(track => track.readyState === 'ended')")
                assert not errors, errors
                passed("finish releases camera tracks with no uncaught browser errors")
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
    print(json.dumps({"passed": checks, "count": len(checks)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
