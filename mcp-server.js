#!/usr/bin/env node

/**
 * WeChat Article Scraper MCP Server
 * 支持 stdio 和 Streamable HTTP 传输模式
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WeChatArticleScraper } from './scraper.js';
import express from 'express';
import cors from 'cors';

// 服务器配置
const SERVER_NAME = 'wechat-scraper-server';
const SERVER_VERSION = '1.0.0';

/**
 * 创建 MCP Server 实例
 */
function createServer() {
    const server = new Server(
        {
            name: SERVER_NAME,
            version: SERVER_VERSION,
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // 注册 list_tools 处理器
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'scrape_wechat_article',
                    description: '抓取微信公众号文章，支持导出 Markdown 和 HTML 格式。可以正确处理懒加载图片，并提取 Readwise Reader API 所需的元数据。',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            url: {
                                type: 'string',
                                description: '微信公众号文章的完整URL',
                            },
                            formats: {
                                type: 'array',
                                description: '需要导出的格式，可选值: markdown, html',
                                items: {
                                    type: 'string',
                                    enum: ['markdown', 'html'],
                                },
                                default: ['markdown', 'html'],
                            },
                            sessionName: {
                                type: 'string',
                                description: 'Scrapeless 会话名称（可选）',
                            },
                            sessionTTL: {
                                type: 'number',
                                description: '会话存活时间（秒），默认 180',
                                default: 180,
                            },
                            proxyCountry: {
                                type: 'string',
                                description: '代理国家代码，默认 CN',
                                default: 'CN',
                            },
                        },
                        required: ['url'],
                    },
                },
            ],
        };
    });

    // 注册 call_tool 处理器
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name === 'scrape_wechat_article') {
            const { url, formats = ['markdown', 'html'], sessionName, sessionTTL, proxyCountry } = request.params.arguments;

            try {
                // 检查 API Key
                const apiKey = process.env.SCRAPELESS_API_KEY || process.env.SCRAPELESS_API_TOKEN;
                if (!apiKey) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: '错误: 请设置 SCRAPELESS_API_KEY 或 SCRAPELESS_API_TOKEN 环境变量',
                            },
                        ],
                        isError: true,
                    };
                }

                // 创建抓取器
                const scraper = new WeChatArticleScraper(apiKey);

                // 抓取文章
                const result = await scraper.scrapeArticle(url, {
                    sessionName: sessionName || `wechat_${Date.now()}`,
                    sessionTTL: sessionTTL || 180,
                    proxyCountry: proxyCountry || 'CN',
                    sessionRecording: true,
                    formats: formats,
                });

                if (!result) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: '抓取失败: 未能提取文章内容',
                            },
                        ],
                        isError: true,
                    };
                }

                // 构建响应内容
                const responseContent = [];

                // 添加基本信息和元数据
                let infoText = `抓取成功!\n\nURL: ${result.url}\n时间: ${result.timestamp}\n状态: ${result.status}\n`;

                if (result.metadata) {
                    infoText += `\n## 元数据 (Readwise 格式)\n`;
                    infoText += `标题: ${result.metadata.title || '(未找到)'}\n`;
                    infoText += `作者: ${result.metadata.author || '(未找到)'}\n`;
                    infoText += `公众号: ${result.metadata.account || '(未找到)'}\n`;
                    infoText += `发布日期: ${result.metadata.published_date || '(未找到)'}\n`;
                    infoText += `封面图片: ${result.metadata.image_url ? '已提取' : '(未找到)'}\n`;
                    infoText += `摘要: ${result.metadata.summary ? result.metadata.summary.substring(0, 100) + '...' : '(未找到)'}\n`;
                    infoText += `文档类型: ${result.metadata.category}\n`;
                }

                responseContent.push({
                    type: 'text',
                    text: infoText,
                });

                // 添加 Readwise 格式的 JSON
                responseContent.push({
                    type: 'text',
                    text: `\n## Readwise Reader API 格式:\n\n\`\`\`json\n${JSON.stringify({
                        url: result.url,
                        html: result.data.html || result.data.markdown,
                        title: result.metadata?.title,
                        author: result.metadata?.author,
                        summary: result.metadata?.summary,
                        published_date: result.metadata?.published_date,
                        image_url: result.metadata?.image_url,
                        category: result.metadata?.category || 'article',
                        saved_using: result.metadata?.saved_using || 'wechat-scraper-mcp',
                    }, null, 2)}\n\`\`\``,
                });

                // 添加 Markdown 内容
                if (result.data.markdown) {
                    responseContent.push({
                        type: 'text',
                        text: `\n## Markdown 内容:\n\n${result.data.markdown}`,
                    });
                }

                // 添加 HTML 内容（如果请求）
                if (result.data.html && formats.includes('html')) {
                    responseContent.push({
                        type: 'text',
                        text: `\n## HTML 内容:\n\n${result.data.html}`,
                    });
                }

                return {
                    content: responseContent,
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `抓取异常: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        }

        return {
            content: [
                {
                    type: 'text',
                    text: `未知工具: ${request.params.name}`,
                },
            ],
            isError: true,
        };
    });

    return server;
}

/**
 * 启动 stdio 传输模式
 */
async function startStdio() {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('WeChat Scraper MCP Server 运行中 (stdio 模式)...');
}

/**
 * 启动 Streamable HTTP 传输模式（无状态）
 */
async function startStreamableHTTP(port = 3000) {
    const app = express();
    app.use(express.json());

    // 配置 CORS
    app.use(cors({
        origin: '*',
        exposedHeaders: ['Mcp-Session-Id']
    }));

    app.post('/mcp', async (req, res) => {
        console.error(`新的 MCP 请求: ${req.body.method}`);

        const server = createServer();

        try {
            // 创建无状态传输（sessionIdGenerator: undefined）
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);

            res.on('close', () => {
                console.error('请求已关闭');
                transport.close();
                server.close();
            });
        } catch (error) {
            console.error('请求处理错误:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                });
            }
        }
    });

    // 对于无状态模式，GET 和 DELETE 不支持
    app.get('/mcp', async (_req, res) => {
        res.writeHead(405).end(JSON.stringify({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: "Method not allowed. This server runs in stateless mode."
            },
            id: null
        }));
    });

    app.delete('/mcp', async (_req, res) => {
        res.writeHead(405).end(JSON.stringify({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: "Method not allowed. This server runs in stateless mode."
            },
            id: null
        }));
    });

    app.listen(port, (error) => {
        if (error) {
            console.error('启动服务器失败:', error);
            process.exit(1);
        }
        console.error(`WeChat Scraper MCP Server 运行在 http://localhost:${port}/mcp (Streamable HTTP 模式)`);
    });

    // 处理服务器关闭
    process.on('SIGINT', async () => {
        console.error('正在关闭服务器...');
        process.exit(0);
    });
}

/**
 * 主函数 - 根据命令行参数选择传输模式
 */
async function main() {
    // 检查必需的环境变量
    const apiKey = process.env.SCRAPELESS_API_KEY || process.env.SCRAPELESS_API_TOKEN;
    if (!apiKey) {
        console.error('❌ 错误: 缺少必需的环境变量');
        console.error('');
        console.error('请设置以下环境变量之一:');
        console.error('  - SCRAPELESS_API_KEY');
        console.error('  - SCRAPELESS_API_TOKEN');
        console.error('');
        console.error('示例:');
        console.error('  export SCRAPELESS_API_KEY="your_api_key_here"');
        console.error('  node mcp-server.js stdio');
        console.error('');
        process.exit(1);
    }

    const args = process.argv.slice(2);
    const mode = args[0] || 'stdio';
    const port = parseInt(args[1]) || 3000;

    switch (mode.toLowerCase()) {
        case 'stdio':
            await startStdio();
            break;
        case 'http':
        case 'streamhttp':
        case 'streamable':
            await startStreamableHTTP(port);
            break;
        default:
            console.error(`未知的传输模式: ${mode}`);
            console.error('用法: node mcp-server.js [stdio|http] [port]');
            console.error('示例:');
            console.error('  node mcp-server.js stdio          # 使用 stdio 模式');
            console.error('  node mcp-server.js http 3000      # 使用 Streamable HTTP 模式，监听 3000 端口');
            process.exit(1);
    }
}

// 运行服务器
main().catch((error) => {
    console.error('启动服务器失败:', error);
    process.exit(1);
});