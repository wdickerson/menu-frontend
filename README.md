# Menu Reader frontend v2.1.5

## Overview

React/TypeScript/Vite app for capturing or finding restaurant menus, saving them
locally, and reading them with a screen reader or spoken Quick Nav gestures.
Shared links create public, permanent snapshots.

## Local development

From this directory with Node.js 22:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173/menu/. Start the API separately and use
[.env.example](.env.example) to configure its address.

Use `npm test` for tests and `npm run build` for type checks and a production build.
Phone camera, native sharing, and clipboard testing require trusted HTTPS, not a
remote LAN HTTP address.

## Deployment

Push to `main` to deploy through AWS CodePipeline to S3 and CloudFront at
https://menu.littleapp.io. 
