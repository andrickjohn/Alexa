# Detroit Wedding Trip itinerary (Vercel)

One page (`index.html`), one map image, and one small API (`api/data.js`) that stores the
shared itinerary in Upstash Redis. Guests just open the link. Editors sign in with a password.

## Deploy (about 5 minutes)

1. Install the CLI and deploy from this folder:
   ```
   npm i -g vercel
   cd wedding-trip
   vercel            # log in, accept defaults, creates the project
   ```
2. Add storage: Vercel dashboard > this project > **Storage** > **Create Database** >
   **Upstash for Redis** (free plan) > **Connect** to this project. This adds the
   `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables automatically.
3. Add the editor password: **Settings > Environment Variables** >
   `EDIT_PASSWORD` = a password you pick (Production, Preview, Development).
4. Redeploy so the variables take effect:
   ```
   vercel --prod
   ```
5. Open the production URL, scroll to the bottom, tap **Editor sign in**, enter the password,
   and publish any small change once. That first publish saves the itinerary to storage.

## Everyday use

- Share the production URL. No accounts, no Claude bar.
- Editors: sign in once per device (iPhone and desktop). Edit, then **Publish to everyone**.
- Open pages refresh on their own within 30 seconds of a publish, and right away when
  someone switches back to the tab.
- Change the password any time in Environment Variables, then run `vercel --prod`.
- Optional: add a custom domain under **Settings > Domains**.
