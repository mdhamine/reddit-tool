import { defineEventHandler, readMultipartFormData, createError } from "h3";

const ALLOWED_TLDS = ["ai", "com", "co", "so", "app"];
const URL_REGEX = /https?:\/\/[^\s<>()"'\]\[]+/gi;

// Matches bare domains with no protocol, e.g. "example.com" or "example.com/pricing".
// - lookbehind stops it matching mid-word (won't double-fire inside a longer token,
//   won't fire off the end of an email's local-part, etc.)
// - requires the domain to end in one of our allowed TLDs
// - optionally grabs a trailing path/query if present
const BARE_DOMAIN_REGEX =
  /(?<![\w.@-])((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:ai|com|co|so|app))(\/[^\s"'()<>\]]*)?/gi;

interface ExtractedLink {
  url: string;
  domain: string;
  tld: string;
  path: string;
}

function cleanTrailingPunctuation(u: string): string {
  return u.replace(/[.,;:!?)\]"'>]+$/, "");
}

function getTld(hostname: string): string {
  const parts = hostname.split(".");
  return parts[parts.length - 1].toLowerCase();
}

function extractUrlsFromString(
  text: string,
  path: string,
  out: ExtractedLink[],
) {
  // Pass 1: full URLs that already have a protocol, e.g. "https://example.com"
  const urlMatches = text.match(URL_REGEX);
  if (urlMatches) {
    for (const raw of urlMatches) {
      const url = cleanTrailingPunctuation(raw);
      try {
        const host = new URL(url).hostname.toLowerCase();
        const tld = getTld(host);
        if (ALLOWED_TLDS.includes(tld)) {
          out.push({ url, domain: host, tld, path });
        }
      } catch {
        // not a parsable URL, skip
      }
    }
  }

  // Mask out whatever Pass 1 already matched so Pass 2 doesn't re-detect
  // the same domain a second time as a "bare" match.
  const maskedText = text.replace(URL_REGEX, (m) => " ".repeat(m.length));

  // Pass 2: bare domains with no protocol, e.g. "example.com" or "example.com/pricing"
  const bareMatches = maskedText.matchAll(BARE_DOMAIN_REGEX);
  for (const m of bareMatches) {
    const domainPart = m[1];
    const pathPart = m[2] ?? "";
    const candidate = cleanTrailingPunctuation(domainPart + pathPart);
    const url = `https://${candidate}`;
    try {
      const host = new URL(url).hostname.toLowerCase();
      const tld = getTld(host);
      if (ALLOWED_TLDS.includes(tld)) {
        out.push({ url, domain: host, tld, path });
      }
    } catch {
      // not a parsable URL, skip
    }
  }
}

// Recursively walk any JSON value — objects, arrays, strings — looking for URLs.
// `path` tracks where in the structure we found it, e.g. "data.comments[3].body"
function walkJson(value: unknown, path: string, out: ExtractedLink[]) {
  if (value == null) return;

  if (typeof value === "string") {
    extractUrlsFromString(value, path, out);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => walkJson(item, `${path}[${i}]`, out));
    return;
  }

  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      walkJson(val, path ? `${path}.${key}` : key, out);
    }
  }
  // numbers, booleans, etc. — nothing to extract
}

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB safety cap

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event);

  if (!formData || !formData.length) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "No file uploaded. Send a JSON file as multipart form data.",
    });
  }

  const file = formData.find((f) => f.name === "file") || formData[0];

  if (!file || !file.data) {
    throw createError({
      statusCode: 400,
      statusMessage: "Could not find file field in upload.",
    });
  }

  if (file.data.length > MAX_FILE_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: "File is too large (max 25MB).",
    });
  }

  let parsed: unknown;
  try {
    const text = file.data.toString("utf-8");
    parsed = JSON.parse(text);
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: "That file is not valid JSON.",
    });
  }

  const results: ExtractedLink[] = [];
  walkJson(parsed, "", results);

  // Dedupe by exact URL, keep first occurrence
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Group by TLD for convenience
  const grouped: Record<string, ExtractedLink[]> = {
    ai: [],
    com: [],
    co: [],
    so: [],
    app: [],
  };
  for (const link of deduped) {
    grouped[link.tld]?.push(link);
  }

  return {
    fileName: file.filename || "uploaded.json",
    totalLinksFound: deduped.length,
    links: deduped,
    grouped,
  };
});
