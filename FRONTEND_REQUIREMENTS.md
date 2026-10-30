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


# Menu Reader frontend requirements — v2.1.0


**Implement "Share This Menu" functionality using the two new API enpoints:**

POST /transcribed_menu
GET /transcribed_menu/<menu_id>

Keep Capture, Search, and Reload above the loaded menu title. Below the title, show
"Enter Quick Nav Mode" followed by "Share This Menu". Capture and Quick Nav use the
primary dark green style; Search, Reload, and Share use the lighter secondary style.
Separate the loaded menu title from the top actions with extra vertical space and a
horizontal divider. When no menu is loaded, show explanatory guidance in its place
with the same divider and generous line spacing. Keep Quick Nav and Share disabled,
using lighter text, borders, and backgrounds to distinguish unavailable controls.

When "Share This Menu" is clicked, POST the currently loaded menu to the API. When the API returns:
-Update localStorage to include this Identifier as sharedMenuId. This is a key in the JSON of the next to restaurantName.
-Use the Web Share API to initiate a share action with the link "menu.littleapp.io/<menu_id>"
-Note: if the menu has been shared before, it should have its ID in localStorage as sharedMenuId, so that it doesn't need to be POSTed

For the recipient, when navigating to "menu.littleapp.io/<menu_id>", perform a GET to retrieve the menu, load it, and save it to localStorage. The menu ID should also be saved to localStorage, so that if this user now shares it, a POST is not needed.

When a user deletes a menu, do not delete it from DynamoDB; only delete it from localStorage

When a user renames a menu, do not rename it in DynamoDB, only locally. However, delete the sharedMenuId property of this menu in localStorage, so that a subsequent share action would share the menu with its new name.

Only perform the POST when a user initiates an intent to share. Most menus will only live locally.

# Menu Reader frontend requirements — v2.1.1

Make the end-of-list thump about 50% louder

Support Quick Nav with up/down left/right arrow keys, so that quick nav can be used on non-touchscreens. Single click repeats; double click changes reading speed. Keep the touch gestures exactly as they are.

When any text is read aloud (either a section or an item), replace the quick nav instruction text with what was read aloud. Be sure to not allow any scrolling on this page, even if the item text is exceptionally long and overflows its container. When a user hits a "thump", do not update the text. When a user exits quick nav mode and then returns to it, display the instructions once again.

# Menu Reader frontend requirements — v2.1.2

On the main page when a menu is loaded, structure the list of items such that a screen reader does not audibly say "bullet" before each menu item, but the bullets still appear visually.

# Menu Reader frontend requirements — v2.1.3

Reduce lag of audible end-of-list thump, especially on iOS Safari

On iOS devices only, play a louder version of the thump.

# Menu Reader frontend requirements — v2.1.4

Change the single-tap functionality in Quick Nav Mode.

If speech is currently playing, single tap stops it.
Then, every successive single tap reads the current section or item one character at a time (including spaces and punctuation). This is so that if a word is dificult to hear, the user can examine how it is spelled.

# Menu Reader frontend requirements — v2.1.5

Do not keep screen awake when on quick nav page.
