import { defineEventHandler, readMultipartFormData, createError } from "h3";

const ALLOWED_TLDS = ["ai", "com", "co", "so", "app"];
const URL_REGEX = /https?:\/\/[^\s<>()"'\]\[]+/gi;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB per file
const MAX_FILES = 25; // safety cap on batch size

const BARE_DOMAIN_REGEX =
  /(?<![\w.@-])((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:ai|com|co|so|app))(\/[^\s"'()<>\]]*)?/gi;

interface ExtractedLink {
  url: string;
  domain: string;
  tld: string;
  path: string;
  sourceFile: string;
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
  sourceFile: string,
  out: ExtractedLink[],
) {
  const urlMatches = text.match(URL_REGEX);
  if (urlMatches) {
    for (const raw of urlMatches) {
      const url = cleanTrailingPunctuation(raw);
      try {
        const host = new URL(url).hostname.toLowerCase();
        const tld = getTld(host);
        if (ALLOWED_TLDS.includes(tld)) {
          out.push({ url, domain: host, tld, path, sourceFile });
        }
      } catch {
        // not a parsable URL, skip
      }
    }
  }

  const maskedText = text.replace(URL_REGEX, (m) => " ".repeat(m.length));

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
        out.push({ url, domain: host, tld, path, sourceFile });
      }
    } catch {
      // not a parsable URL, skip
    }
  }
}

function walkJson(
  value: unknown,
  path: string,
  sourceFile: string,
  out: ExtractedLink[],
) {
  if (value == null) return;

  if (typeof value === "string") {
    extractUrlsFromString(value, path, sourceFile, out);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      walkJson(item, `${path}[${i}]`, sourceFile, out),
    );
    return;
  }

  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      walkJson(val, path ? `${path}.${key}` : key, sourceFile, out);
    }
  }
}

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event);

  if (!formData || !formData.length) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "No files uploaded. Send one or more JSON files as multipart form data.",
    });
  }

  // Collect every part named "file" — this is what makes multi-file work,
  // since the frontend now appends each selected file under the same key.
  const files = formData.filter((f) => f.name === "file" && f.data);

  if (!files.length) {
    throw createError({
      statusCode: 400,
      statusMessage: "Could not find any file fields in upload.",
    });
  }

  if (files.length > MAX_FILES) {
    throw createError({
      statusCode: 413,
      statusMessage: `Too many files (max ${MAX_FILES} per upload).`,
    });
  }

  const allResults: ExtractedLink[] = [];
  const processedFileNames: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const fileName = file.filename || "uploaded.json";

    if (file.data.length > MAX_FILE_BYTES) {
      errors.push(`${fileName}: too large (max 25MB)`);
      continue;
    }

    let parsed: unknown;
    try {
      const text = file.data.toString("utf-8");
      parsed = JSON.parse(text);
    } catch {
      errors.push(`${fileName}: not valid JSON`);
      continue;
    }

    walkJson(parsed, "", fileName, allResults);
    processedFileNames.push(fileName);
  }

  if (!processedFileNames.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `None of the uploaded files could be processed. ${errors.join("; ")}`,
    });
  }

  // Dedupe by exact URL across the whole batch, keep first occurrence
  const seen = new Set<string>();
  const deduped = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

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
    fileNames: processedFileNames,
    fileCount: processedFileNames.length,
    totalLinksFound: deduped.length,
    links: deduped,
    grouped,
    errors,
  };
});
