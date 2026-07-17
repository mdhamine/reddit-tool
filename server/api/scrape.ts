import { defineEventHandler, readMultipartFormData, createError } from "h3";

const ALLOWED_TLDS = ["ai", "com", "co", "so", "app"];
const URL_REGEX = /https?:\/\/[^\s<>()"'\]\[]+/gi;

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
  const matches = text.match(URL_REGEX);
  if (!matches) return;

  for (const raw of matches) {
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
