import { defineEventHandler, readBody, createError } from "h3";

const ALLOWED_TLDS = ["ai", "com", "app", "co"];
const URL_REGEX = /https?:\/\/[^\s<>()"'\]\[]+/gi;

interface ExtractedLink {
  url: string;
  domain: string;
  tld: string;
  author: string;
  commentPermalink: string;
}

function normalizeRedditUrl(input: string): string {
  let url = input.trim();

  if (!/^https?:\/\//i.test(url)) {
    if (url.startsWith("/r/")) {
      url = `https://old.reddit.com${url}`;
    } else {
      throw createError({
        statusCode: 400,
        statusMessage: "Please provide a full Reddit thread URL.",
      });
    }
  }

  const parsed = new URL(url);
  if (!/(^|\.)reddit\.com$/i.test(parsed.hostname)) {
    throw createError({
      statusCode: 400,
      statusMessage: "That does not look like a reddit.com URL.",
    });
  }

  // Force old.reddit.com — tends to be less aggressively rate-limited than www
  parsed.hostname = "old.reddit.com";
  parsed.search = "";
  parsed.hash = "";
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith(".json")) pathname += ".json";
  parsed.pathname = pathname;
  return parsed.toString();
}

function cleanTrailingPunctuation(u: string): string {
  return u.replace(/[.,;:!?)\]"'>]+$/, "");
}

function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  return (text.match(URL_REGEX) || []).map(cleanTrailingPunctuation);
}

function getTld(hostname: string): string {
  const parts = hostname.split(".");
  return parts[parts.length - 1].toLowerCase();
}

function walkComments(
  children: any[],
  permalinkBase: string,
  out: ExtractedLink[],
) {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (!child || child.kind !== "t1" || !child.data) continue;
    const data = child.data;
    const body: string = data.body || "";
    const author: string = data.author || "[unknown]";
    const commentPermalink = data.permalink
      ? `https://www.reddit.com${data.permalink}`
      : permalinkBase;

    for (const rawUrl of extractUrlsFromText(body)) {
      try {
        const host = new URL(rawUrl).hostname.toLowerCase();
        const tld = getTld(host);
        if (ALLOWED_TLDS.includes(tld)) {
          out.push({
            url: rawUrl,
            domain: host,
            tld,
            author,
            commentPermalink,
          });
        }
      } catch {}
    }

    if (data.replies?.data?.children) {
      walkComments(data.replies.data.children, permalinkBase, out);
    }
  }
}

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  let lastRes: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res;
    lastRes = res;
    if (res.status !== 429 && res.status !== 403) break;
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return lastRes as Response;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url?: string }>(event);
  const inputUrl = body?.url;

  if (!inputUrl || typeof inputUrl !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing "url" in request body.',
    });
  }

  const jsonUrl = normalizeRedditUrl(inputUrl);
  const res = await fetchWithRetry(jsonUrl);

  if (!res.ok) {
    throw createError({
      statusCode: res.status,
      statusMessage: `Reddit returned ${res.status} while fetching the thread. It may be private, quarantined, or rate-limited.`,
    });
  }

  const data = await res.json();
  const postListing = data?.[0]?.data?.children?.[0]?.data;
  const commentListing = data?.[1]?.data?.children;

  if (!postListing || !commentListing) {
    throw createError({
      statusCode: 502,
      statusMessage:
        "Unexpected response shape from Reddit — thread may not exist.",
    });
  }

  const results: ExtractedLink[] = [];

  if (postListing.selftext) {
    for (const rawUrl of extractUrlsFromText(postListing.selftext)) {
      try {
        const host = new URL(rawUrl).hostname.toLowerCase();
        const tld = getTld(host);
        if (ALLOWED_TLDS.includes(tld)) {
          results.push({
            url: rawUrl,
            domain: host,
            tld,
            author: postListing.author || "[unknown]",
            commentPermalink: `https://www.reddit.com${postListing.permalink}`,
          });
        }
      } catch {}
    }
  }

  walkComments(
    commentListing,
    `https://www.reddit.com${postListing.permalink}`,
    results,
  );

  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  const grouped: Record<string, ExtractedLink[]> = {
    ai: [],
    com: [],
    app: [],
    co: [],
  };
  for (const link of deduped) grouped[link.tld]?.push(link);

  return {
    thread: {
      title: postListing.title,
      author: postListing.author,
      permalink: `https://www.reddit.com${postListing.permalink}`,
      numComments: postListing.num_comments,
    },
    totalLinksFound: deduped.length,
    links: deduped,
    grouped,
  };
});
