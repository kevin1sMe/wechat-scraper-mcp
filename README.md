# 微信公众号文章抓取器 (Node.js)

使用 Scrapeless SDK 抓取微信公众号文章，正确处理懒加载图片。

## 功能特点

- ✅ 使用 Scrapeless Browser API 进行浏览器自动化
- ✅ 自动滚动页面触发懒加载图片
- ✅ 智能修复 SVG 占位符，提取真实图片 URL
- ✅ 支持导出 Markdown 和 HTML 格式
- ✅ 自动保存结果到文件
- ✅ **MCP Server 支持** - 支持 stdio 和 Streamable HTTP 传输模式

## 安装依赖

```bash
npm install
```

## 环境变量设置

设置你的 Scrapeless API Key：

```bash
export SCRAPELESS_API_KEY="your_api_key_here"
```

或者使用 `.env` 文件：

```bash
echo "SCRAPELESS_API_KEY=your_api_key_here" > .env
```

## 使用方法

### 1. 作为独立脚本运行

#### 运行测试

```bash
npm test
```

#### 直接运行抓取器

```bash
npm run scrape
```

#### 在代码中使用

```javascript
import { WeChatArticleScraper } from './scraper.js';

const scraper = new WeChatArticleScraper('your_api_key');

const result = await scraper.scrapeArticle(
    'https://mp.weixin.qq.com/s/umG_UtpfpEG5riNzfjvpwA',
    {
        sessionName: 'my_session',
        sessionTTL: 180,
        proxyCountry: 'CN',
        sessionRecording: true,
        formats: ['markdown', 'html']
    }
);

// 保存结果
await scraper.saveResult(result, 'output.json');
```

### 2. 作为 MCP Server 运行

#### stdio 模式 (适用于 Claude Desktop)

```bash
npm run mcp
# 或者
node mcp-server.js stdio
```

在 Claude Desktop 配置文件中添加:

```json
{
  "mcpServers": {
    "wechat-scraper": {
      "command": "node",
      "args": ["/path/to/wechat-scraper-nodejs/mcp-server.js", "stdio"],
      "env": {
        "SCRAPELESS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Streamable HTTP 模式 (用于远程调用)

```bash
npm run mcp:http
# 或者
node mcp-server.js http 3000
```

然后发送 POST 请求到: `http://localhost:3000/mcp`

**注意**: SSE 模式已在 MCP 协议 2024-11-05 版本中弃用，请使用 Streamable HTTP 模式替代。

### 3. MCP 工具使用示例

当 MCP server 运行后，可以使用以下工具:

#### scrape_wechat_article

抓取微信公众号文章

**参数:**
- `url` (必需): 微信公众号文章的完整 URL
- `formats` (可选): 导出格式数组, 可选值: `['markdown', 'html']`，默认为 `['markdown', 'html']`
- `sessionName` (可选): Scrapeless 会话名称
- `sessionTTL` (可选): 会话存活时间(秒)，默认 180
- `proxyCountry` (可选): 代理国家代码，默认 'CN'

**示例请求 (Streamable HTTP 模式):**

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
        "url": "https://mp.weixin.qq.com/s/umG_UtpfpEG5riNzfjvpwA",
        "formats": ["markdown"]
      }
    }
  }'
```

**注意**: Streamable HTTP 需要包含 `Accept: application/json, text/event-stream` 头，响应为 SSE 格式。

## 工作原理

1. **连接到 Scrapeless Browser** - 使用 Puppeteer 通过 WebSocket 连接
2. **导航到目标页面** - 加载微信公众号文章
3. **等待内容加载** - 等待页面完全加载
4. **滚动页面** - 多次滚动触发所有懒加载图片
5. **获取 HTML** - 获取完整的页面 HTML
6. **修复图片** - 从 `data-src` 等属性提取真实图片 URL
7. **转换格式** - 转换为 Markdown 和 HTML
8. **保存结果** - 保存到文件

## 输出文件

运行后会生成以下文件：

- `wechat_article_TIMESTAMP.json` - 完整的抓取结果（JSON 格式）
- `wechat_article_TIMESTAMP.md` - Markdown 格式的文章内容
- `wechat_article_TIMESTAMP.html` - HTML 格式的文章内容

## 依赖包

- `@scrapeless-ai/sdk` - Scrapeless 官方 SDK
- `puppeteer-core` - Puppeteer 核心库
- `cheerio` - HTML 解析库
- `turndown` - HTML 转 Markdown 工具

## 常见问题

### 图片仍然是占位符？

确保：
1. 滚动次数足够（默认滚动 5 次）
2. 等待时间足够（每次滚动后等待 1 秒）
3. 检查微信文章是否使用了不同的图片属性名

### 连接超时？

尝试：
1. 增加 `sessionTTL` 时间
2. 检查网络连接
3. 更换 `proxyCountry` 参数

## License

MIT