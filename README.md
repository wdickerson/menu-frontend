# Menu Reader frontend v1.0.0

React/TypeScript/Vite app for capturing menus, saving them locally, and reading
them with a screen reader or spoken Quick Nav gestures.
See [FRONTEND_REQUIREMENTS.md](FRONTEND_REQUIREMENTS.md) for current behavior.

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
	to the complete endpoint, including `/menus`, and restart Vite. Blank/unset uses the
	deployed endpoint in [src/menuApi.ts](src/menuApi.ts). Start the API separately.
- Vite configuration is public and baked into builds: never include provider keys.
	Remove local endpoint overrides before deployment. Phone loopback refers to the phone.
- Use HTTPS in production and verify API CORS for the frontend origin.
- Run tests before release: deployment builds/type-checks and uploads to S3, but does
	not run tests. Production builds override the base path to `/`.
- Native camera behavior, audible speech/thumps, and screen-reader usability need
	real-device checks; unit tests do not prove those work. Live transcription costs money.
  