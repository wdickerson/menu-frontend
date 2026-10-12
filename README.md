# Menu Reader frontend

React/TypeScript single-page app. The main screen shows a scrollable menu with
section headings and lists. Quick Nav provides spoken flick navigation.

## Development and checks

- Install dependencies with `npm install`.
- Start Vite with `npm run dev`.
- Run regression tests with `npm test`.
- Build with `npm run build`.

## Capture a new menu

**Capture a New Menu** opens a viewport-filling camera screen using
`getUserMedia`, preferring the rear camera. Grant camera permission, then use
**Capture an image** for each page of the same restaurant's menu, in reading
order. Previews have individually labeled remove buttons. Pinching the preview
applies digital zoom (1–4×); captured JPEGs use the same centered crop.

The top-left **Flashlight** toggle uses the camera's torch capability. It is
disabled with an explanation on cameras/browsers without torch support. Turning
it on lights the scene continuously, rather than using a native photo flash.
Closing the camera or submitting the photos stops the camera and its light.

**Load this menu** posts repeated `images` file fields in browser-generated
multipart form data to:

https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menus

There are at most ten photos and 4,500,000 combined image bytes. Each photo is
resized to at most 2400 pixels on its longest edge and compressed to at most
250 KB (250,000 bytes), reducing JPEG quality and dimensions as needed. The same
per-image limit is checked again before posting; oversized images are never sent.
Remove images if the combined limit is reached. Submitting immediately returns
to the main screen, stops the camera, and displays **Processing your menu…** with
a message that processing may take 20 seconds or longer. The previous menu is
not replaced until processing succeeds. Failed uploads retain the photos in
memory for **Retry loading menu**, without reopening the camera.

**Cancel processing** cancels the pending browser request and returns to the
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

Camera access requires a secure context: HTTPS, or localhost on the same device.
Opening a development server on a phone via an HTTP LAN IP is **not** a secure
context. Use HTTPS for real-device camera testing. No file-picker fallback or
credentials are required by the frontend.

The API's allowed CORS origin must match the frontend origin. The existing API
defaults to https://menu.littleapp.io; a localhost origin may therefore be
blocked. API and infrastructure configuration have not been changed by this
frontend feature. Live menu loads can incur transcription charges.

Automated unit tests cover storage, API validation/errors, multipart fields,
upload limits, flashlight constraints, and zoomed JPEG capture. Browser verification uses page-scoped
camera/API mocks and does not make paid API calls. Real camera sharpness, pinch
feel, permissions on Safari/Chrome, audible speech, and live deployment CORS
still require testing on a device.