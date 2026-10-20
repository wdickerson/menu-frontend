# Menu Reader frontend requirements — v1.0.0

## Reading and navigation

- Mobile-first single-page app with a compact title/introduction and Capture, Recent Menus,
	and Quick Nav actions. Home shows the restaurant, section headings, and item lists;
	scrolling and screen-reader navigation work normally, without custom gestures.
- Quick Nav is a separate, non-scrolling touch screen with static instructions and Exit.
	With screen readers off, one-finger flicks move down/up through next/previous sections
	and right/left through next/previous items. Tap repeats the last utterance.
- Double-tap announces the speed; consecutive double-taps cycle 1–3.5× in 0.5 increments
	(default 1.5×). List boundaries thump instead of wrapping; reversing reads the endpoint.
- Browser Back closes nested dialogs/image inspection before their parent screens.
	Navigation leaves the URL unchanged; refreshing starts home with saved preferences.
- Use a light, high-contrast theme, green primary/grey secondary/red destructive actions,
	labeled controls, visible focus, modal focus handling, and announced status/errors.

## Capture and saved menus

- Capture requests the native rear camera or browser image picker. Support up to five
	photos with removable thumbnails, full-screen inspection, Add another image, and Submit.
- Prepare JPEGs sequentially: preserve aspect ratio, never upscale, and fit within 1568 pixels.
	One photo allows 900,000 bytes using quality reduction only; multiple photos allow
	350,000 bytes each with further shrinking. Enforce a 4,500,000-byte combined limit.
- Submit returns home to processing immediately; keep the previous menu until success.
	Support cancel, recoverable errors, and retry with retained photos. The 35-second request
	timeout excludes preparation. Photos remain memory-only and are discarded when no longer needed.
- Persist up to ten menus, the selected menu, and speech rate in localStorage; warn if saving fails.
	Seed only new libraries with the renameable/deletable Rough & Tumble sample.
- Show the application version only in a subtle Recent Menus footer: “Menu Reader v1.0.0”.
- Recent Menus offers Load, Rename, and confirmed Delete; show capture dates below names.
	Deleting the selected menu leaves none loaded and disables Quick Nav until another is loaded.
