# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a WeChat article scraper that operates in two modes:
1. **Standalone scraper** - Direct Node.js library for scraping WeChat articles
2. **MCP Server** - Model Context Protocol server exposing scraping capabilities as tools

The project uses Scrapeless SDK for browser automation to handle WeChat's lazy-loaded images and extract article content with full metadata compatible with Readwise Reader API.

## Core Architecture

### Three Main Components

1. **scraper.js** - Core scraping logic
   - `WeChatArticleScraper` class handles all scraping operations
   - Uses Scrapeless Browser API (Puppeteer-based) for browser automation
   - Extracts metadata (title, author, published date, images) for Readwise compatibility
   - Converts content to Markdown (via turndown) and HTML
   - Key methods:
     - `scrapeArticle()` - Main entry point, handles browser automation
     - `extractMetadata()` - Extracts article metadata (title, author, date, cover image, summary)
     - `processHtmlContent()` - Parses and processes HTML with cheerio
     - `fixLazyImages()` - Replaces SVG placeholders with real image URLs from data-src attributes

2. **mcp-server.js** - MCP Server implementation
   - Uses `@modelcontextprotocol/sdk` v1.18.2
   - Supports two transport modes:
     - **stdio**: For local tools like Claude Desktop (default)
     - **Streamable HTTP**: Stateless HTTP endpoint for remote access
   - Exposes one tool: `scrape_wechat_article`
   - Tool returns structured data including Readwise Reader API format

3. **test.js** - Simple test script for standalone scraper mode

### Key Technical Details

**Lazy Image Handling**: WeChat uses SVG placeholders for lazy-loaded images. The scraper:
- Scrolls the page 5 times with 1-second delays to trigger lazy loading
- Searches for `data-src`, `data-original`, and `data-lazy-src` attributes
- Replaces placeholder src with actual image URLs

**Metadata Extraction** (scraper.js:161-251):
- Extracts from multiple HTML sources: `#activity-name`, `.rich_media_title`, `og:title` meta tags
- Parses WeChat date format to ISO 8601
- Creates Readwise-compatible output with required fields: url, html, title, author, summary, published_date, image_url, category, saved_using

**MCP Server Transport**:
- Streamable HTTP uses stateless mode (`sessionIdGenerator: undefined`)
- Returns SSE (Server-Sent Events) format responses
- Requires `Accept: application/json, text/event-stream` header
- Each request creates a new server instance (stateless design)

## Development Commands

```bash
# Install dependencies
npm install

# Run standalone scraper (edit scraper.js main() function first)
npm run scrape

# Run test script
npm test

# Start MCP server in stdio mode (for Claude Desktop)
npm run mcp

# Start MCP server in HTTP mode (for remote access)
npm run mcp:http

# Direct invocation with custom port
node mcp-server.js http 3001
```

## Environment Setup

**Required**: Set `SCRAPELESS_API_KEY` environment variable before running:
```bash
export SCRAPELESS_API_KEY="your_key_here"
```

Alternative environment variable name: `SCRAPELESS_API_TOKEN`

## MCP Server Configuration

### For Claude Desktop (stdio mode)
Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
```json
{
  "mcpServers": {
    "wechat-scraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server.js", "stdio"],
      "env": {
        "SCRAPELESS_API_KEY": "your_key_here"
      }
    }
  }
}
```

### For Remote Access (HTTP mode)
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "scrape_wechat_article",
      "arguments": {
        "url": "https://mp.weixin.qq.com/s/ARTICLE_ID",
        "formats": ["markdown", "html"]
      }
    }
  }'
```

## Output Files

Standalone mode generates timestamped files in project root:
- `wechat_article_TIMESTAMP.json` - Full structured result
- `wechat_article_TIMESTAMP.md` - Markdown content
- `wechat_article_TIMESTAMP.html` - HTML content

MCP mode returns all content in the tool response (no files created).

## Important Implementation Notes

**Scrapeless Browser Configuration**:
- Default session TTL: 180 seconds
- Default proxy country: CN (required for WeChat access)
- Session recording enabled by default for debugging
- Browser automation uses `networkidle0` wait strategy with 60s timeout

**HTML Parsing Selectors**:
- Article content: `#js_content` or `.rich_media_content`
- Title: `#activity-name`, `.rich_media_title`, or `og:title` meta
- Author: `#js_name`, `.rich_media_meta_nickname`
- Publish date: `#publish_time`, `.rich_media_meta_text`

**MCP Transport Modes**:
- stdio: Synchronous request-response over stdin/stdout
- Streamable HTTP: SSE-based responses, stateless (new server per request)
- SSE mode has been DEPRECATED in MCP spec as of 2024-11-05, use Streamable HTTP instead

## Module Type

This is an ES module (`"type": "module"` in package.json). All imports must use `.js` extensions and ES6 import syntax.