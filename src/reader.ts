import { chromium, Browser, Route } from "playwright";
import TurndownService from "turndown";
import * as cheerio from "cheerio";

// --- Config ---

const JINA_API_KEY = process.env.JINA_API_KEY || "";

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map<string, { content: string; timestamp: number }>();

const MIN_CONTENT_LENGTH = 200;

const JUNK_INDICATORS = [
  "something went wrong",
  "try again",
  "please disable",
  "enable javascript",
  "browser not supported",
  "access denied",
  "please verify",
  "checking your browser",
  "just a moment",
];

// --- URL detection ---

function isTwitterUrl(url: string): boolean {
  return /^https?:\/\/(x\.com|twitter\.com)\//i.test(url);
}

function extractTweetPath(url: string): string | null {
  const match = url.match(
    /(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/i
  );
  return match ? `${match[1]}/status/${match[2]}` : null;
}

// --- Content quality check ---

function isJunkContent(text: string): boolean {
  const lower = text.toLowerCase();
  return JUNK_INDICATORS.some((indicator) => lower.includes(indicator));
}

function isValidContent(text: string): boolean {
  return text.length >= MIN_CONTENT_LENGTH && !isJunkContent(text);
}

// --- Provider: fetch (raw HTTP, instant) ---

async function tryFetch(url: string): Promise<string | null> {
  console.error(`[fetch] ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const html = await res.text();
    const markdown = htmlToMarkdown(html);

    if (!isValidContent(markdown)) {
      console.error(`[fetch] content invalid (${markdown.length} chars or junk), skipping`);
      return null;
    }

    return markdown;
  } catch (e) {
    console.error(`[fetch] failed: ${(e as Error).message}`);
    return null;
  }
}

// --- Provider: FXTwitter (Twitter-specific, <1s) ---

async function tryFxTwitter(url: string): Promise<string | null> {
  const tweetPath = extractTweetPath(url);
  if (!tweetPath) return null;

  const apiUrl = `https://api.fxtwitter.com/${tweetPath}`;
  console.error(`[fxtwitter] ${apiUrl}`);

  try {
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { tweet?: any };
    const tweet = data.tweet;
    if (!tweet) return null;

    const formatted = formatTweet(tweet);
    if (!tweet.text || tweet.text.trim().length < 10) {
      console.error(`[fxtwitter] tweet text empty or too short, skipping`);
      return null;
    }
    return formatted;
  } catch (e) {
    console.error(`[fxtwitter] failed: ${(e as Error).message}`);
    return null;
  }
}

function formatTweet(tweet: any): string {
  const lines: string[] = [];

  lines.push(`# ${tweet.author?.name || "Unknown"} (@${tweet.author?.screen_name || "unknown"})`);
  lines.push("");
  lines.push(tweet.text || "");
  lines.push("");

  if (tweet.media?.photos?.length) {
    for (const photo of tweet.media.photos) {
      lines.push(`![Image](${photo.url})`);
    }
    lines.push("");
  }

  if (tweet.media?.videos?.length) {
    for (const video of tweet.media.videos) {
      lines.push(`[Video](${video.url})`);
    }
    lines.push("");
  }

  const stats: string[] = [];
  if (tweet.likes) stats.push(`${tweet.likes} likes`);
  if (tweet.retweets) stats.push(`${tweet.retweets} retweets`);
  if (tweet.replies) stats.push(`${tweet.replies} replies`);
  if (tweet.views) stats.push(`${tweet.views.toLocaleString()} views`);

  if (stats.length) {
    lines.push(`---`);
    lines.push(stats.join(" · "));
  }

  if (tweet.created_at) {
    lines.push(`Posted: ${tweet.created_at}`);
  }

  lines.push(`Source: ${tweet.url || ""}`);

  return lines.join("\n").trim();
}

// --- Provider: Jina (API, ~8s) ---

async function tryJina(url: string): Promise<string | null> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  console.error(`[jina] ${jinaUrl}`);

  try {
    const headers: Record<string, string> = {
      Accept: "text/markdown",
    };
    if (JINA_API_KEY) {
      headers["Authorization"] = `Bearer ${JINA_API_KEY}`;
    }

    const res = await fetch(jinaUrl, {
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (!isValidContent(text)) {
      console.error(`[jina] content invalid (${text.length} chars or junk), skipping`);
      return null;
    }

    return text;
  } catch (e) {
    console.error(`[jina] failed: ${(e as Error).message}`);
    return null;
  }
}

// --- Provider: Playwright (headless browser, heavy, last resort) ---

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
  "png", "jpg", "jpeg", "gif", "svg", "webp",
  "mp3", "mp4", "webm", "avi", "mov", "flac", "wav", "ogg",
];

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance?.isConnected()) return browserInstance;

  browserInstance = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-first-run",
    ],
  });

  return browserInstance;
}

async function tryPlaywright(url: string): Promise<string | null> {
  console.error(`[playwright] ${url}`);

  try {
    const browser = await getBrowser();
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });

    try {
      await page.route("**/*", (route: Route) => {
        const reqUrl = route.request().url();
        const isBlocked =
          BLOCKED_DOMAINS.some((d) => reqUrl.includes(d)) ||
          BLOCKED_EXTENSIONS.some((ext) => reqUrl.endsWith(`.${ext}`));
        if (isBlocked) route.abort();
        else route.continue();
      });

      await page.addInitScript(() => {
        const nav = (globalThis as any).navigator;
        Object.defineProperty(nav, "webdriver", { get: () => false });
        Object.defineProperty(nav, "plugins", { get: () => [1, 2, 3] });
        Object.defineProperty(nav, "languages", { get: () => ["en-US", "en"] });
      });

      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Upgrade-Insecure-Requests": "1",
      });

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch {
        await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch(() => null);
      }

      await page.waitForTimeout(3000);
      const html = await page.content();
      return htmlToMarkdown(html);
    } finally {
      await page.close();
    }
  } catch (e) {
    console.error(`[playwright] failed: ${(e as Error).message}`);
    return null;
  }
}

// --- HTML to Markdown (shared by fetch + playwright) ---

function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);

  // Remove junk elements
  $("script, style, nav, header, footer, aside, noscript, iframe").remove();

  // Twitter-specific junk
  $('[data-testid="sidebarColumn"]').remove();
  $('[aria-label="Trending"]').remove();
  $('[aria-label="Who to follow"]').remove();
  $('[role="complementary"]').remove();
  $('a[href="/i/flow/signup"]').closest("div").remove();
  $('a[href*="explore/tabs"]').closest("div").remove();

  // Try to find main content
  let content =
    $("main").html() ||
    $("article").html() ||
    $('[class*="content"], [class*="main"], [class*="post"], [class*="entry"], [class*="article"]').first().html() ||
    $("body").html() ||
    html;

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  let markdown = turndown.turndown(content);

  // Clean up whitespace
  markdown = markdown
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown;
}

// --- Main entry point ---

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

  const isTwitter = isTwitterUrl(url);
  let result: string | null = null;

  // Layer 1: fetch (instant, works for static sites)
  result = await tryFetch(url);
  if (result) {
    console.error(`[success] fetch`);
    cache.set(url, { content: result, timestamp: Date.now() });
    return objective ? filterByObjective(result, objective) : result;
  }

  // Layer 2 (Twitter only): FXTwitter
  if (isTwitter) {
    result = await tryFxTwitter(url);
    if (result) {
      console.error(`[success] fxtwitter`);
      cache.set(url, { content: result, timestamp: Date.now() });
      return objective ? filterByObjective(result, objective) : result;
    }
  }

  // Layer 3: Jina
  result = await tryJina(url);
  if (result) {
    console.error(`[success] jina`);
    cache.set(url, { content: result, timestamp: Date.now() });
    return objective ? filterByObjective(result, objective) : result;
  }

  // Layer 4: Playwright (last resort)
  result = await tryPlaywright(url);
  if (result) {
    console.error(`[success] playwright`);
    cache.set(url, { content: result, timestamp: Date.now() });
    return objective ? filterByObjective(result, objective) : result;
  }

  throw new Error(`All providers failed for ${url}`);
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
