# Menu Reader frontend v2.1.5

React/TypeScript/Vite app for capturing menus, saving them locally, and reading
them with a screen reader or spoken Quick Nav gestures. Web search finds candidate
menus; selecting one transcribes, loads, and saves it to Recent Menus.
See [FRONTEND_REQUIREMENTS.md](FRONTEND_REQUIREMENTS.md) for current behavior.

## Home page

- Capture, Search, and Reload appear above the loaded menu title. A horizontal
	divider and extra spacing separate these actions from the menu.
- **Enter Quick Nav Mode** appears directly below the title, followed by
	**Share This Menu**. Capture and Quick Nav are dark green primary actions;
	the other actions use the lighter secondary style.
- With no menu loaded, explanatory guidance replaces the title and menu contents.
	Quick Nav and Share remain disabled with lighter text, borders, and backgrounds.
- The home footer includes creator and social links. The application version
	remains in the Recent Menus footer.
- Menu items are plain text rows with decorative, screen-reader-hidden bullets,
	so bullets remain visible without being announced before each item.

## Quick Nav

- Quick Nav does not request a screen wake lock; normal screen timeout settings apply.
- Flick or use arrow keys: up/down for sections, left/right for items.
- Tap or single-click during menu speech to stop it. Successive taps/clicks read
	one character at a time, including spoken names for spaces and punctuation.
	If speech has already finished, the first tap reads the first character.
	Each spelling tap advances even if the previous character is still speaking.
	At the end, taps thump without wrapping; navigating resets spelling to the new
	section/item. The full menu text stays displayed. Touch double-taps retain their
	existing speed announcement/cycling behavior; each mouse double-click changes
	the speed without replacing the menu text being spelled.
- Spoken sections/items replace the instructions; boundary thumps and speed
	announcements leave that text unchanged. Reentering restores the instructions.
- When speech is idle, a single-finger touch starts a zero-volume speech warm-up
	before the swipe is completed, reducing the observed iOS speech startup lag.
	It never interrupts active or queued speech. Menu speech and boundary cues cancel
	the warm-up immediately; it does not change the spelling cursor or tap timing.
	There is no periodic speech keepalive, and exiting cancels an outstanding warm-up.
- Long text is clipped rather than scrolled. The boundary recording has 50% more
	amplitude without clipping; audible loudness still needs real-device checks.
- Boundary thumps are fetched and decoded into memory when Quick Nav opens,
	then played directly through one low-latency Web Audio context, with a fresh source
	per cue. One-time silent warmup prepares playback on entry or user interaction.
	iOS devices (including iPads using desktop mode) select a louder, soft-limited
	recording with no PCM clipping; other devices retain the existing recording.
	Both use the same playback path. Playback-session intent is retained where supported and
	restored on exit. If the decoded buffer is unavailable, an audio element provides
	a metadata-preloaded fallback. Loading never replays an old cue. Touch timing and
	the non-iOS recording are unchanged.
- iOS has a [reported speech-synthesis ducking bug](https://bugs.webkit.org/show_bug.cgi?id=278598)
	that briefly lowers other audio after speech. The finger-down speech warm-up also
	produced consistently quieter thumps in on-device testing, rather than louder
	thumps after longer pauses; this is consistent with ducking, not proof of its cause.
	No dedicated ducking workaround is retained. Regression tests cover immediate cue
	scheduling, silent speech warm-up, buffer reuse, fallback, cancellation, and cleanup;
	they cannot measure speech onset or final volume changes applied by the operating system.

## Sharing

- **Share This Menu** saves a snapshot only on demand, then opens native sharing
	with `https://menu.littleapp.io/<id>`. The menu's `sharedMenuId` is saved locally
	and reused. If native sharing is unavailable, the link is copied automatically.
	Only errors or “Share link copied to clipboard.” appear below the button.
- Opening a shared link loads and saves the menu and its ID to Recent Menus.
	After saving, the URL returns to the app root so refreshing does not re-import it.
	If browser storage fails, the link stays in the URL for recovery.
- Rename removes the local sharing ID so the next share saves the new name.
	Delete stays local; existing links remain unchanged. Share links are public.
- Shared snapshots are permanent and cannot be revoked in the app. Do not share
	sensitive information; deleting a local menu does not delete its shared snapshot.
- Deploy API v2.1 and its CloudFormation routes/table first. Sharing uses sibling
	`/transcribed_menu` POST/GET endpoints, with no new frontend environment setting.

## Development

From this directory, using Node.js 22:

```sh
npm ci
npm run dev
```

- `npm test`: regression tests.
- `npm run build`: TypeScript checks and production build.
- `npm run preview`: preview the build. Vite's default base path is `/menu/`.

LAN HTTP access (for example, `http://10.0.0.151:5173/menu/`) supports app startup
and local menu IDs without `crypto.randomUUID()`. Camera access, native sharing,
and clipboard access still require a secure context on iPhone; use HTTPS with a
certificate trusted by the phone to test those features. HTTP `localhost` is a
secure-context exception only on the device running the browser, not a remote LAN IP.

## API and deployment

- Copy [.env.example](.env.example) for local API configuration; set `VITE_MENU_API_URL`
	to the complete image endpoint, including `/menu_image_transcribe`, and restart Vite. Blank/unset uses the
	deployed endpoint in [src/menuApi.ts](src/menuApi.ts). Start the API separately.
- Search uses `/menu_online_search` on the same API host and stage. Legacy
	`/menus` configuration is migrated automatically to the renamed image route.
	Deploy API v2.1 and the CloudFormation changes before releasing this client.
	Search requires `EnableLiveSearch=true`. The current stack defaults both paid
	flags on; explicitly set them false until credentials and cost controls are ready.
- Search sends `{"query":"..."}` (1–500 characters). API `422/no_menu_found`
	shows the no-match state; service failures remain recoverable errors. The search
	form and results share one page. Completed results and the draft survive trips
	home until a new search is submitted; clearing or editing the draft keeps results.
	Back returns home and cancels any pending search. Back/Forward never silently
	repeats paid requests. Queries and results remain memory-only and reset on refresh.
- Each result is a non-clickable card with a “Load this Menu” button and a
	menu-source link directly below the description. The link uses the result's
	`source_url` field, never from `agent_instructions`. Unsafe or blank source links
	are hidden without rejecting the result. Private agent extraction instructions
	are never rendered. Deploy the API and frontend together for this four-field contract.
- Selecting a result posts `{"query":"original query","menu":{...}}` to
	`/menu_online_transcribe` on the same API host/stage. All four result fields are
	sent unchanged, with the query that produced the results, not an edited draft.
- Online and image transcription share the home processing screen, 35-second
	network deadline, cancellation, recoverable errors, and retry behavior. The old
	menu remains selected until success; the result is then added to the same
	localStorage library. Leaving home while processing cancels ownership, and
	Back/Forward never automatically repeats a paid transcription request.
- Online transcription uses the existing `EnableLiveTranscription` flag and
	OpenAI credentials even if image transcription uses Anthropic. Search has its
	separate `EnableLiveSearch` flag. Deploy the new gateway route and API code
	before the frontend; this release does not add a new enablement flag.
- Vite configuration is public and baked into builds: never include provider keys.
	Remove local endpoint overrides before deployment, or explicitly set `VITE_MENU_API_URL`
	in the build environment to the intended production image endpoint. A root-base build
	alone still loads local dotenv overrides. CodeBuild explicitly supplies the production
	endpoint. Phone loopback refers to the phone.
- Use HTTPS in production and verify API CORS for the frontend origin.
- Run tests before release: deployment builds/type-checks and uploads to S3, but does
	not run tests. Run `npm ci`, `npm test`, `npm audit`, and
	`npm run build -- --base=/` before release. Production builds override the base path to `/`.
- Include all new sharing modules/tests and the synchronized npm lockfile in the
	release commit; a local build does not prove untracked files exist in GitHub.
- Release in order: completed stack update, API deployment and route checks, then
	frontend deployment. Verify opening and refreshing a shared link saves it locally
	and returns to the app root. Sharing links use the production hostname above;
	a custom deployment domain does not automatically change generated links.
- Native camera behavior, audible speech/thumps, and screen-reader usability need
	real-device checks; unit tests do not prove those work. Live transcription and web search cost money.
  