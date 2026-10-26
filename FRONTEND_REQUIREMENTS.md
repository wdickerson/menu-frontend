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
- Preserve empty sections and blank headings in API responses and saved menus.
	In an empty section, every left/right flick only plays the boundary thump, including
	repeated flicks and direction reversals; section navigation remains available.
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

# Menu Reader frontend requirements — v2.0.0

## Online search and loading

- Label the first two home actions “Capture a Menu with Camera” and “Search for a Menu Online”.
	Send image transcription requests to `/menu_image_transcribe`.
- Online search uses one page for the query and results, with instructions:
	“Describe the menu you are looking for. Be specific (ie, Rough & Tumble Columbia City dinner menu).”
	Include a query input, an “x” clear control on its right, Search, and Back.
- Search posts the query to `/menu_online_search` and shows a loading state, followed by
	“Found X possible matches. Select one to load” or “Could not find a menu”. Retain results
	until another query is made, including when navigating home and back to search.
- Each result card shows the venue and menu identifiers, a source link just below the
	menu description, and a “Load this Menu” button. The card itself is not clickable.
- Use only `source_url` for the source link; hide blank or unusable links without rejecting
	the result. Never display `agent_instructions` or extract links from it.
- “Load this Menu” posts the original search query and selected result's four fields
	(`venue_identifier`, `menu_identifier`, `source_url`, `agent_instructions`) to
	`/menu_online_transcribe` as `{"query":"original query","menu":{...}}`.
- While transcription is pending, show processing feedback like image transcription.
	On success, load the menu and save it to localStorage using the existing menu library flow.

## Quick Nav and version display

- Keep the screen awake in Quick Nav, including while the user is inactive.
- Make “Exit Quick Nav Mode” a compact, right-aligned, link-like control, about half the
	previous button height rather than full width.
- Cycle speech rates through 1, 1.25, 1.5, 1.75, 2, and 2.5×; retain the default of 1.5×.
- Show “Menu Reader v2.0.0” only in the subtle Recent Menus footer.
