# Menu Reader frontend

React/TypeScript single-page app. The main screen shows a scrollable menu with
section headings and lists. Quick Nav provides spoken flick navigation.
The home page has a compact **Menu Reader** title and a short introduction.
In Quick Nav, flick **right** for the next item and **left** for the previous
item. Section navigation is unchanged: flick **up** for the next section and
**down** for the previous section.

## Browser navigation

Browser **Back** returns from Quick Nav, Recent Menus, or photo capture to home.
Inside Rename/Delete dialogs or full-screen image inspection, Back first closes
that view and returns to its parent screen. Close, Cancel, Save, Load, and Exit
use the same history rather than adding duplicate home screens. Submitting
photos returns home to processing; Back does not reopen the submitted photos.
Leaving photo capture without submitting discards its photos. Forward restores
screens where possible, but discarded photos are not restored. Saved menu edits
are not undone by Back/Forward. Navigation does not change the URL, and refreshing
always starts at home with the saved menu and speech rate.

## Development and checks

- Install dependencies with `npm install`.
- Start Vite with `npm run dev`.
- Run regression tests with `npm test`.
- Build with `npm run build`.

### Choose the API endpoint

Vite loads a local dotenv file from this frontend directory. Copy
[.env.example](.env.example) to a local dotenv file named `.env` to use
**http://127.0.0.1:8000/menus** by default on your machine. Start the local API
separately using the [API startup instructions](../menu-api/README.md).

Set `VITE_MENU_API_URL` to the **complete endpoint**, including `/menus`.
If the variable is missing, empty, or whitespace-only, the frontend uses
https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menus instead.
Local dotenv files are gitignored; the example is safe to commit.
Restart Vite after changing the configuration. Shell environment variables and
Vite's mode-specific dotenv files follow Vite's standard precedence rules.

`VITE_` values are public and embedded at build time: never put an OpenAI key or
other secret in frontend configuration. A configured local URL also applies to
`npm run build`; remove/unset it or override it with the deployed URL when building
for deployment. On a phone, loopback refers to the phone, not the development Mac.

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
multipart form data to the configured API URL, defaulting to:

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

Returned menus and the selected menu are saved in browser localStorage. Up to
ten saved menus appear as cards under **Reload a Recent Menu**. Each card has
**Load**, **Rename**, and **Delete** buttons. Rename opens a full-page dialog
with the current name and **Cancel** / **Save** buttons; blank names cannot be
saved. Delete opens a full-page confirmation with **Cancel** / **Delete** buttons.
Changes are persisted immediately. Deleting the loaded menu returns to the
**No menu loaded** home page and disables Quick Nav until a menu is explicitly
loaded, even if other recent menus remain. This empty selection persists across
reloads. When a menu is loaded, its restaurant name appears above the sections
on the home page.

First-time visitors receive **Rough & Tumble (Sample Menu)** in their saved
library. It can be renamed or deleted like any other menu, and is not restored
on later visits unless localStorage is cleared. Existing saved libraries are
preserved without injecting a sample. The former fixed Rough & Tumble and
Twilight choices are no longer displayed. Camera images are not stored in
localStorage. A storage failure leaves changes usable in the current session
and displays a warning. Speech rate is also preserved.

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