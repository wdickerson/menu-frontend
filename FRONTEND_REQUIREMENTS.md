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

# Menu Reader frontend requirements — v1.1.0

Introduce a new method by which users can find a menu and transcribe it: Web search

Under the "Capture a new menu" button, add a button: "Search the web for a menu"

Clicking this button starts a new, two-step user flow. In v1.1.0, we are just implementing the first step of the flow:

Clicking "Search the web for a menu" opens a new page with:
  -text instructions: "Describe the menu you are looking for. Be specific (ie, Rough & Tumble Columbia City dinner menu)."
  -an input field for user input
  -a Search button that sends the query to the `/menu_online_search` endpoint
  -a Back button that goes back

Clicking "Search" sends the query and opens a new page with a loading state. Once the API returns, the 1 to 8 options are displayed, below the text "Found X possible matches. Select one to load". Or it can display "Could not find a menu". Possible menues are shown in clickable cards with their venue identifier and menu identifier. Agent instruction is not shown. There is a back button at the bottom that return to the search page.

We will implement menu loading in a later version.

Each result also includes `source_url`. Display a separate source link using that attribute, without extracting URLs from `agent_instructions`. Keep agent instructions hidden for the future transcription agent. Blank or unusable source URLs hide the link without rejecting the menu result.

# Menu Reader frontend requirements — v1.2.0

Building on v1.1.0, allow a user to load a menu form the search results page.

When a user clicks on the menu, send a POST the `/menu_online_transcribe` endpoint with the three API-provided parameters, as well as the original search query. (The original search query is provided in case it helps the agent determine the venue name).

While the POST is pending, show a screen similar to when the user is waiting for image transcription. Consider using a shared componenent, but only if that makes sense.

When the POST returns, load the menu and save it to localStorage, just as we do for image transcription.


# Menu Reader frontend requirements — v1.2.1

Keep screen awake while in quick nav mode, even if the user seems to be inactive

Make the Exit Quick Nav Mode button smaller. Make it more like link text, about half of its current height, aligned to the right of the page, not full width.

Change speed setting tap value to be: 1, 1.25, 1.5, 1.75, 2, 2.5

# Menu Reader frontend requirements — v1.3.0

Make the web search page and the search results page one single page, and retain the search results until another query is made, even if a user navigates to the homepage and then back to web search. Place an "x" in the input box, on the right, to clear the current search term.

On the home page, make the text in the first two buttons:
"Capture a Menu with Camera"
"Search for a Menu Online"

