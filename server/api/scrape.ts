import { defineEventHandler, readBody, createError } from 'h3'

// Domains (TLDs) we keep. Matched against the hostname's final label.
const ALLOWED_TLDS = ['ai', 'com', 'app', 'co']

// Matches http(s) URLs embedded anywhere in comment text (markdown links, raw links, etc)
const URL_REGEX = /https?:\/\/[^\s<>()"'\]\[]+/gi

interface ExtractedLink {
  url: string
  domain: string
  tld: string
  author: string
  commentPermalink: string
}

function normalizeRedditUrl(input: string): string {
  let url = input.trim()

  // Allow share-style URLs and bare thread paths
  if (!/^https?:\/\//i.test(url)) {
    if (url.startsWith('/r/')) {
      url = `https://www.reddit.com${url}`
    } else {
      throw createError({ statusCode: 400, statusMessage: 'Please provide a full Reddit thread URL.' })
    }
  }

  const parsed = new URL(url)
  if (!/(^|\.)reddit\.com$/i.test(parsed.hostname)) {
    throw createError({ statusCode: 400, statusMessage: 'That does not look like a reddit.com URL.' })
  }

  // Strip query params/fragments, strip trailing slash, then append .json
  parsed.search = ''
  parsed.hash = ''
  let pathname = parsed.pathname.replace(/\/+$/, '')
  if (!pathname.endsWith('.json')) {
    pathname += '.json'
  }
  parsed.pathname = pathname
  // Force old.reddit / www host -> just keep as-is, both serve .json fine on reddit.com
  return parsed.toString()
}

function cleanTrailingPunctuation(u: string): string {
  return u.replace(/[.,;:!?)\]"'>]+$/, '')
}

function extractUrlsFromText(text: string): string[] {
  if (!text) return []
  const matches = text.match(URL_REGEX) || []
  return matches.map(cleanTrailingPunctuation)
}

function getTld(hostname: string): string {
  const parts = hostname.split('.')
  return parts[parts.length - 1].toLowerCase()
}

// Recursively walk Reddit's nested comment listing structure
function walkComments(children: any[], permalinkBase: string, out: ExtractedLink[]) {
  if (!Array.isArray(children)) return

  for (const child of children) {
    if (!child || child.kind !== 't1' || !child.data) continue
    const data = child.data
    const body: string = data.body || ''
    const author: string = data.author || '[unknown]'
    const commentPermalink = data.permalink
      ? `https://www.reddit.com${data.permalink}`
      : permalinkBase

    const urls = extractUrlsFromText(body)
    for (const rawUrl of urls) {
      try {
        const host = new URL(rawUrl).hostname.toLowerCase()
        const tld = getTld(host)
        if (ALLOWED_TLDS.includes(tld)) {
          out.push({
            url: rawUrl,
            domain: host,
            tld,
            author,
            commentPermalink
          })
        }
      } catch {
        // ignore unparsable urls
      }
    }

    // Recurse into replies
    if (data.replies && data.replies.data && Array.isArray(data.replies.data.children)) {
      walkComments(data.replies.data.children, permalinkBase, out)
    }
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url?: string }>(event)
  const inputUrl = body?.url

  if (!inputUrl || typeof inputUrl !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing "url" in request body.' })
  }

  const jsonUrl = normalizeRedditUrl(inputUrl)

  const res = await fetch(jsonUrl, {
    headers: {
      // Reddit blocks generic/default user agents on some endpoints
      'User-Agent': 'reddit-url-extractor/1.0 (script for personal use)'
    }
  })

  if (!res.ok) {
    throw createError({
      statusCode: res.status,
      statusMessage: `Reddit returned ${res.status} while fetching the thread. It may be private, quarantined, or rate-limited.`
    })
  }

  const data = await res.json()

  // data[0] = post listing, data[1] = comment listing
  const postListing = data?.[0]?.data?.children?.[0]?.data
  const commentListing = data?.[1]?.data?.children

  if (!postListing || !commentListing) {
    throw createError({ statusCode: 502, statusMessage: 'Unexpected response shape from Reddit — thread may not exist.' })
  }

  const results: ExtractedLink[] = []

  // Also scan the self-post body/URL itself, not just comments
  if (postListing.selftext) {
    const urls = extractUrlsFromText(postListing.selftext)
    for (const rawUrl of urls) {
      try {
        const host = new URL(rawUrl).hostname.toLowerCase()
        const tld = getTld(host)
        if (ALLOWED_TLDS.includes(tld)) {
          results.push({
            url: rawUrl,
            domain: host,
            tld,
            author: postListing.author || '[unknown]',
            commentPermalink: `https://www.reddit.com${postListing.permalink}`
          })
        }
      } catch {}
    }
  }

  walkComments(commentListing, `https://www.reddit.com${postListing.permalink}`, results)

  // Dedupe by exact URL, keep first occurrence
  const seen = new Set<string>()
  const deduped = results.filter((r) => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })

  // Group by TLD for convenience
  const grouped: Record<string, ExtractedLink[]> = { ai: [], com: [], app: [], co: [] }
  for (const link of deduped) {
    grouped[link.tld]?.push(link)
  }

  return {
    thread: {
      title: postListing.title,
      author: postListing.author,
      permalink: `https://www.reddit.com${postListing.permalink}`,
      numComments: postListing.num_comments
    },
    totalLinksFound: deduped.length,
    links: deduped,
    grouped
  }
})
