# Menu Reader frontend v2.1.0

React/TypeScript/Vite app for capturing menus, saving them locally, and reading
them with a screen reader or spoken Quick Nav gestures. Web search finds candidate
menus; selecting one transcribes, loads, and saves it to Recent Menus.
See [FRONTEND_REQUIREMENTS.md](FRONTEND_REQUIREMENTS.md) for current behavior.

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
	Remove local endpoint overrides before deployment. Phone loopback refers to the phone.
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
  