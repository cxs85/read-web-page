import { chromium, Page, Route } from "playwright";
import TurndownService from "turndown";

const BLOCKED_DOMAINS = [
  "doubleclick.net",
  "adservice.google.com",
  "googlesyndication.com",
  "facebook.com/tr",
  "analytics.google.com",
  "google-analytics.com",
  "facebook.net",
  "connect.facebook.net",
  "bat.bing.com",
  "clarity.ms",
  "hotjar.com",
  "intercom.io",
  "segment.com",
  "cdn.segment.com",
];

const BLOCKED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "mp3",
  "mp4",
  "webm",
  "avi",
  "mov",
  "flac",
  "wav",
  "ogg",
];

// Cache for parsed pages
const cache = new Map<string, { content: string; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function readWebPage(
  url: string,
  objective?: string,
  forceRefetch?: boolean
): Promise<string> {
  // Check cache
  if (!forceRefetch) {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.error(`[cache hit] ${url}`);
      return objective
        ? filterByObjective(cached.content, objective)
        : cached.content;
    }
  }

  console.error(`[scraping] ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-first-run",
    ],
  });

  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });

    // Block ads and media
    await page.route("**/*", (route: Route) => {
      const url = route.request().url();
      const isBlocked =
        BLOCKED_DOMAINS.some((d) => url.includes(d)) ||
        BLOCKED_EXTENSIONS.some((ext) => url.endsWith(`.${ext}`));

      if (isBlocked) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Stealth mode: mask webdriver
    await page.addInitScript(() => {
      const nav = (global as any).navigator;
      Object.defineProperty(nav, "webdriver", {
        get: () => false,
      });
      Object.defineProperty(nav, "plugins", {
        get: () => [1, 2, 3],
      });
      Object.defineProperty(nav, "languages", {
        get: () => ["en-US", "en"],
      });
    });

    // Custom headers
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });

    // Navigate
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    } catch (e) {
      // Fallback
      await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch(
        () => null
      );
    }

    // Wait for content
    await page.waitForTimeout(3000);

    // Get HTML
    const html = await page.content();

    // Extract main content
    const markdown = await convertToMarkdown(html);

    // Cache it
    cache.set(url, { content: markdown, timestamp: Date.now() });

    return objective ? filterByObjective(markdown, objective) : markdown;
  } finally {
    await browser.close();
  }
}

async function convertToMarkdown(html: string): Promise<string> {
  // Remove script, style, nav, header, footer, ads
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

  // Try to extract main content
  const main =
    cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    cleaned.match(/<div[^>]*class="[^"]*(?:content|main|post|entry|article)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ||
    cleaned;

  // Use Turndown for HTML → Markdown
  const turndownService = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  let markdown = turndownService.turndown(main);

  // Clean up excessive whitespace
  markdown = markdown
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown;
}

function filterByObjective(content: string, objective: string): string {
  const lines = content.split("\n");
  const keywords = objective.toLowerCase().split(/\s+/);

  const relevant = lines.filter((line: string) => {
    const lower = line.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  });

  return relevant.length > 0 ? relevant.join("\n") : content;
}
