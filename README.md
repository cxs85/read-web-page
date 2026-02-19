# read-web-page MCP

MCP server that provides a `read_web_page` tool for AI agents. Uses a smart multi-layered fallback chain to read any URL reliably.

## How It Works

```
ANY URL → fetch (instant)
           ├── Got real content? → return ✅
           └── Empty/broken?
                ├── Twitter/X? → FXTwitter (<1s) → Jina (~8s) → Playwright (last resort)
                └── Other URL? → Jina (~8s) → Playwright (last resort)
```

Each layer tries the lightest option first. Playwright (headless Chrome) only fires if everything else fails.

## Features

- ✅ Multi-layer fallback chain (fetch → FXTwitter → Jina → Playwright)
- ✅ Twitter/X optimized via FXTwitter API (instant, clean JSON)
- ✅ Handles JavaScript-heavy sites (Playwright as last resort)
- ✅ Converts HTML to Markdown
- ✅ Content extraction with cheerio (removes nav, sidebars, ads)
- ✅ Junk content detection (error pages, login walls)
- ✅ Simple caching (24h TTL)
- ✅ Objective-based filtering (returns relevant excerpts)
- ✅ Browser instance reuse (no cold start per request)
- ✅ Optional Jina API key for higher rate limits

## Setup

```bash
npm install
npm run build
```

### Environment Variables (optional)

```bash
# Jina API key — bumps rate limit from 20 to 500 RPM
export JINA_API_KEY=your_key_here
```

## Usage with AI Agents

Add to your agent config:

**Local instance:**
```json
{
  "mcpServers": {
    "read-web-page": {
      "command": "node",
      "args": ["/path/to/dist/index.js"]
    }
  }
}
```

**Via npx:**
```json
{
  "mcpServers": {
    "read-web-page": {
      "command": "npx",
      "args": ["read-web-page-mcp"]
    }
  }
}
```

**VPS instance (remote):**
```json
{
  "mcpServers": {
    "read-web-page": {
      "command": "ssh",
      "args": ["user@vps.example.com", "node /path/to/dist/index.js"]
    }
  }
}
```

## Tool API

### `read_web_page`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | The URL to read |
| `objective` | string | ❌ | What info you're looking for (returns relevant excerpts) |
| `forceRefetch` | boolean | ❌ | Skip cache, fetch live |

**Returns:** Markdown-formatted content

## Providers

| Provider | Speed | Best For | Needs Setup |
|----------|-------|----------|-------------|
| **fetch** | instant | Static sites, blogs, docs | None |
| **FXTwitter** | <1s | Tweets, X posts | None |
| **Jina** | ~8s | JS-heavy sites, X articles | Optional API key |
| **Playwright** | ~7s | Last resort, complex pages | Chromium installed |

## Performance

| Scenario | Provider Used | Time |
|----------|--------------|------|
| Static website | fetch | <1s |
| Tweet | FXTwitter | ~2s |
| X long-form article | Jina | ~3s |
| JS-heavy app (worst case) | Playwright | ~7s |
| Cached request | cache | <1ms |

## Architecture

```
Agent ── stdio ──→ MCP Server
                      │
                      ├── fetch (native HTTP)
                      ├── FXTwitter API (api.fxtwitter.com)
                      ├── Jina Reader API (r.jina.ai)
                      └── Playwright (headless Chromium)
```

## Install from npm

```bash
npm i read-web-page-mcp
```
