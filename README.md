# Menu Reader frontend

React/TypeScript single-page app. The main screen shows a scrollable menu with
section headings and lists. Quick Nav provides spoken flick navigation.

## Development and checks

- Install dependencies with `npm install`.
- Start Vite with `npm run dev`.
- Run regression tests with `npm test`.
- Build with `npm run build`.

## Capture a new menu

**Capture a New Menu** immediately requests the phone's native rear camera via
an image file input with `capture="environment"`. The browser/device decides
whether to open the camera directly or offer a picker; desktop browsers use a
file picker. Camera zoom and flash are controlled by the native camera app.

After taking a photo, the preview screen immediately shows small image thumbnails with
individually labeled **×** remove buttons. Tap a thumbnail to inspect the
image full screen; **Close** returns to the previews. The original photo is
shown immediately, then replaced by the upload-sized JPEG when it is ready.
Photos are prepared sequentially in the background to limit memory use.
**Add another image** reopens the native camera without waiting for preparation.
Removing a photo cancels its queued preparation. Cancelling the camera leaves
existing photos intact, and **Close** on the preview screen discards unsent photos.

**Done** immediately returns to the existing **Processing your menu…** screen,
even if photos are still being prepared. Once all photos are ready it posts
repeated `images` file fields in browser-generated
multipart form data to:

https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menus

There are at most ten photos and 4,500,000 combined image bytes. Each photo is
resized to at most 1024 pixels in either dimension, preserving the original aspect
ratio without cropping or upscaling, and compressed to at most
350 KB (350,000 bytes), reducing JPEG quality and dimensions as needed. The same
per-image limit is checked again before posting; oversized images are never sent.
Remove images if the combined limit is reached. Submitting immediately returns
to the main screen and displays **Processing your menu…** with
a message that processing may take 20 seconds or longer. The previous menu is
not replaced until processing succeeds. Failed uploads retain the photos in
memory for **Retry loading menu**, without reopening the camera.
Successful JPEGs are reused on retry; failed preparation can retry its original
photo. The API's 35-second timeout starts only when the request is sent, not
while waiting for on-device preparation.

**Cancel processing** cancels queued preparation and/or the pending browser request and returns to the
previous menu. Closing the camera before submitting discards its unsent photos.
Cancelling a request cannot
guarantee that the backend stops processing an already-submitted upload.

Returned menus and the selected menu are saved in browser localStorage; the
most recent ten captured menus appear under **Reload a Recent Menu**, alongside
Rough & Tumble and Twilight. Camera images are not stored in localStorage. A
storage failure leaves the menu usable in the current session and displays a
warning. Speech rate is also preserved, and existing saved restaurant choices
are migrated automatically.

## Browser requirements and deployment

Native capture support depends on the phone/browser; browsers without it offer
an image file picker. JPEG and other browser-decodable images are converted to
JPEG before uploading. Unsupported formats display a recoverable error asking
for a JPEG. Use HTTPS in deployment. No camera stream or frontend credentials
are required.

Supporting browsers use JPEG header dimensions and EXIF orientation to request
upload-sized `createImageBitmap` decoding, without first loading the full image
into an image element. Other formats and unsupported decoding options fall back
to normal browser image decoding. JPEG quality retries reuse the canvas pixels;
the photo is redrawn only when its dimensions need to decrease.

For phone performance checks, development builds log `[menu-image preparation]`
with decode, draw, encode, attempt-count, and total timings. All builds also
record `menu-image:total`, `menu-image:decode`, `menu-image:draw`, and
`menu-image:encode` entries in the browser Performance API. Draw and encode
durations aggregate all retries for that photo. Timings contain
no filenames or image data. Native decoding/encoding may not be interruptible;
cancelling discards its result and prevents remaining work or a later upload.

The API's allowed CORS origin must match the frontend origin. The existing API
defaults to https://menu.littleapp.io; a localhost origin may therefore be
blocked. API and infrastructure configuration have not been changed by this
frontend feature. Live menu loads can incur transcription charges.

Automated unit tests cover storage, API validation/errors, multipart fields,
upload limits, image decoding, resized JPEG preparation, EXIF metadata, and
background queue ordering/removal/cancellation/retry. Browser verification
uses file uploads and mocked API responses, without paid API calls. Native
camera launch, photo sharpness, Safari/Chrome format support, audible speech, and live deployment CORS
still require testing on a device.