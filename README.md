# read-web-page MCP

MCP server that provides a `read_web_page` tool for OpenClaw agents. Uses Playwright for robust browser automation and JS rendering.

## Features

- ✅ Handles JavaScript-heavy sites (renders with browser)
- ✅ Works with login walls (basic support)
- ✅ Converts HTML to Markdown
- ✅ Content extraction (removes nav, sidebars, ads)
- ✅ Simple caching (24h TTL)
- ✅ Objective-based filtering (returns relevant excerpts)
- ✅ Shared across multiple OpenClaw instances

## Setup

```bash
npm install
npm run build
```

## Usage with OpenClaw

Add to your OpenClaw config (`~/.openclaw/openclaw.json`):

**Local instance:**
```json
{
  "mcp": {
    "servers": {
      "read-web-page": {
        "command": "node",
        "args": ["/path/to/dist/index.js"]
      }
    }
  }
}
```

**VPS instance (remote):**
```json
{
  "mcp": {
    "servers": {
      "read-web-page": {
        "type": "stdio",
        "command": "ssh",
        "args": ["user@vps.example.com", "node /path/to/dist/index.js"]
      }
    }
  }
}
```

## Tool Usage

From OpenClaw chat:

```
@read_web_page Read https://example.com
```

With objective:

```
@read_web_page Read https://example.com - I want the pricing section
```

Force live fetch:

```
@read_web_page Read https://example.com (force refresh, I want pricing)
```

## API

### Tool: `read_web_page`

**Parameters:**
- `url` (required): The URL to read
- `objective` (optional): What info you're looking for (returns excerpts)
- `forceRefetch` (optional): Skip cache, fetch live

**Returns:** Markdown-formatted content

## Architecture

```
OpenClaw ──┬─ stdio ─→ MCP Server (local)
           │
           └─ stdio (over ssh) ─→ MCP Server (VPS)
```

Both instances talk to their own server via stdio. The server uses Playwright to fetch & render.

## Performance Notes

- First request: ~3-5s (browser startup)
- Cached requests: <100ms
- Playwright runs headless, uses 50-150MB RAM per request

## Security

- Browser runs headless, no visible windows
- All requests local to server (no proxying)
- Cache is in-memory only
- Set `forceRefetch: true` if sensitive data

## TODOs

- [ ] Persistent cache (SQLite)
- [ ] Proxy support (corporate networks)
- [ ] Authentication headers support
- [ ] Better HTML→Markdown conversion (turndown.js)
- [ ] Concurrent request limiting
