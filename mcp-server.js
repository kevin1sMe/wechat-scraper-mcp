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

// 从环境变量读取允许的 API Keys（逗号分隔）
const MCP_API_KEYS = process.env.MCP_API_KEYS
    ? process.env.MCP_API_KEYS.split(',').map(key => key.trim()).filter(key => key)
    : [];

/**
 * 带时间戳的日志函数
 */
function logWithTimestamp(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const levelMap = {
        'info': console.error,
        'warn': console.error,
        'error': console.error
    };
    const logger = levelMap[level] || console.error;
    logger(`[${timestamp}] ${message}`);
}

/**
 * Bearer Token 验证中间件
 */
function authenticateRequest(req, res, next) {
    // 如果没有配置 API Keys，跳过验证
    if (MCP_API_KEYS.length === 0) {
        logWithTimestamp('警告: 未配置 MCP_API_KEYS，跳过身份验证', 'warn');
        return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader) {
        logWithTimestamp('身份验证失败: 缺少 Authorization header', 'warn');
        return res.status(401).json({
            jsonrpc: '2.0',
            error: {
                code: -32001,
                message: 'Unauthorized: Missing Authorization header',
            },
            id: null,
        });
    }

    // 验证 Bearer Token 格式
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        logWithTimestamp('身份验证失败: Authorization header 格式错误', 'warn');
        return res.status(401).json({
            jsonrpc: '2.0',
            error: {
                code: -32001,
                message: 'Unauthorized: Invalid Authorization header format. Expected: Bearer <token>',
            },
            id: null,
        });
    }

    const token = parts[1];

    // 验证 token 是否在允许列表中
    if (!MCP_API_KEYS.includes(token)) {
        logWithTimestamp('身份验证失败: 无效的 API Key', 'warn');
        return res.status(403).json({
            jsonrpc: '2.0',
            error: {
                code: -32002,
                message: 'Forbidden: Invalid API Key',
            },
            id: null,
        });
    }

    logWithTimestamp('身份验证成功');
    next();
}

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

                // 构建 JSON 响应
                const jsonResponse = {
                    status: 'success',
                    url: result.url,
                    timestamp: result.timestamp,
                    metadata: result.metadata || {},
                };

                // 添加 markdown 内容（如果有）
                if (result.data.markdown) {
                    jsonResponse.markdown = result.data.markdown;
                }

                // 添加 HTML 内容（如果有）
                if (result.data.html) {
                    jsonResponse.html = result.data.html;
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(jsonResponse, null, 2),
                    }],
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
    logWithTimestamp('WeChat Scraper MCP Server 运行中 (stdio 模式)...');
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

    app.post('/mcp', authenticateRequest, async (req, res) => {
        logWithTimestamp(`新的 MCP 请求: ${req.body.method}`);

        const server = createServer();

        try {
            // 创建无状态传输（sessionIdGenerator: undefined）
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);

            res.on('close', () => {
                logWithTimestamp('请求已关闭');
                transport.close();
                server.close();
            });
        } catch (error) {
            logWithTimestamp(`请求处理错误: ${error.message}`, 'error');
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
            logWithTimestamp(`启动服务器失败: ${error.message}`, 'error');
            process.exit(1);
        }
        logWithTimestamp(`WeChat Scraper MCP Server 运行在 http://localhost:${port}/mcp (Streamable HTTP 模式)`);
        if (MCP_API_KEYS.length > 0) {
            logWithTimestamp(`身份验证: 已启用 (配置了 ${MCP_API_KEYS.length} 个 API Key)`);
        } else {
            logWithTimestamp(`身份验证: 未启用 (未配置 MCP_API_KEYS)`, 'warn');
        }
    });

    // 处理服务器关闭
    process.on('SIGINT', async () => {
        logWithTimestamp('正在关闭服务器...');
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
            logWithTimestamp(`未知的传输模式: ${mode}`, 'error');
            console.error('用法: node mcp-server.js [stdio|http] [port]');
            console.error('示例:');
            console.error('  node mcp-server.js stdio          # 使用 stdio 模式');
            console.error('  node mcp-server.js http 3000      # 使用 Streamable HTTP 模式，监听 3000 端口');
            process.exit(1);
    }
}

// 运行服务器
main().catch((error) => {
    logWithTimestamp(`启动服务器失败: ${error.message}`, 'error');
    process.exit(1);
});