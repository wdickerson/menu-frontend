# Menu Reader frontend

React / TypeScript / Vite. Use Node 20 or newer. The deployed asset base is `/menu/`.

- `npm ci` — install locked dependencies.
- `npm run dev` — start the mobile-accessible development server.
- `npm run build` — type-check and build the production app.
- `npm test` — run the offline API, photo-preparation, and capture-flow regression tests.

## Capturing a menu (Version 11)

Hold one finger on the reader to open the menu chooser (or press Escape with a
keyboard), then select **Capture Menu Images**. Take a photo with the rear camera
or choose multiple existing JPEG, PNG, or WebP photos. Camera/file-picker behavior
depends on the device; desktop browsers normally open a file picker. Canceling
the picker leaves existing photos alone.

Add up to ten pages from one restaurant. Review the prepared photos, zoom to
check text, retake/remove pages, and move them earlier/later in reading order.
Dense menus are best photographed in smaller, sharp sections. Photo preparation
is entirely on-device: EXIF orientation is respected, the initial longest edge
is capped at 2,560 pixels without upscaling, and JPEG quality/resolution adapt to
keep **every uploaded image at or below 250,000 bytes**. The prepared JPEG preview
is the actual image that will be sent. Originals are not uploaded. HEIC files
that the browser cannot decode must be exported as JPEG first. Originals above
40 MB or known dimensions above 50 megapixels are rejected before decoding to
protect phone memory; prepare such images as smaller crops first.

Only pressing **Submit photos & read menu** sends a request. One multipart POST
with ordered, repeated `images` file fields is sent to the hardcoded endpoint:
https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menus.
The browser sets the multipart boundary; no API keys, dummy flag, or model
overrides are sent. Successful, validated live responses replace the reader's
menu and reset navigation to its first section/item. Speech speed is unchanged.

Errors retain prepared photos for manual retries or retakes. Submission times
out after 45 seconds; cancellation stops the browser waiting, but the service
may already have received/processed the request. There are no automatic retries.
Going back requires confirmation before discarding a photo draft. Photos and
object URLs are released when leaving capture; drafts do not survive reloads.
Only the latest transcribed menu, its selection, and speed are saved to browser
localStorage, when available. If saving fails, the reader warns that its menu
will be lost on reload and clears the stale saved transcription. Example menus
remain selectable.

Capture screens scroll and support normal touch/zoom; the gesture reader keeps
its fixed, non-scrolling behavior. Controls have explicit labels, visible focus,
large touch targets, live status/error feedback, and speech announcements.

## Integration checks

Automated tests mock the API and never invoke paid transcription. Real browser
checks should confirm photo orientation and text quality on iOS/Android and
audible speech/touch feel on a phone. AI transcription can be wrong: confirm
important prices and allergy information with staff.

The API currently documents CORS for `https://menu.littleapp.io`. Requests from
localhost or another origin may be blocked by the deployed service; a frontend
cannot fix server-side CORS. This implementation makes no infrastructure or
CloudFormation changes.