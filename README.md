# Reddit Thread URL Extractor

Paste a Reddit thread URL, scrape every comment (recursively, including nested replies),
extract embedded URLs, and filter down to `.ai`, `.com`, `.app`, and `.co` domains.

Built with **Nuxt 3** + **Tailwind**. No external scraping libraries — uses Reddit's public
`.json` endpoint (e.g. `https://www.reddit.com/r/foo/comments/xyz/.json`), so no API keys needed.

## How it works

1. You paste a thread URL like `https://www.reddit.com/r/webdev/comments/abc123/some_title/`
2. `server/api/scrape.ts` normalizes it, appends `.json`, fetches it server-side
3. Recursively walks the nested comment tree (`replies.data.children`)
4. Regex-extracts all `http(s)://` URLs from each comment body and the post's selftext
5. Filters to hostnames ending in `.ai`, `.com`, `.app`, `.co`
6. Dedupes and returns grouped + flat results to the frontend
7. UI lets you filter by TLD tab, copy the list, or download as CSV

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000

## Build for production

```bash
npm run build
node .output/server/index.mjs
```

## Notes / limitations

- Only works on public, non-quarantined subreddits (Reddit's `.json` endpoint requirement)
- Reddit may rate-limit anonymous requests if you hit this often — for heavy use, consider
  adding OAuth via Reddit's API and a custom User-Agent with your app name
- Very large threads ("load more comments" placeholders) may not have every reply expanded
  in the single `.json` fetch — Reddit collapses deep threads behind `more` stubs which
  aren't currently followed
# reddit
