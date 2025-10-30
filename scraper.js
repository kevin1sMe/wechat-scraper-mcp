/**
 * 使用 Scrapeless SDK 抓取微信公众号文章
 */

import { Puppeteer } from '@scrapeless-ai/sdk';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { promises as fs } from 'fs';

class WeChatArticleScraper {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('API Key 是必需的');
        }
        this.apiKey = apiKey;
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });
        this.stepTimers = {};
    }

    /**
     * 格式化时间戳
     */
    getTimestamp() {
        return new Date().toISOString();
    }

    /**
     * 记录步骤开始
     */
    startStep(stepName) {
        this.stepTimers[stepName] = Date.now();
    }

    /**
     * 记录步骤结束并计算用时
     */
    endStep(stepName) {
        if (this.stepTimers[stepName]) {
            const duration = Date.now() - this.stepTimers[stepName];
            delete this.stepTimers[stepName];
            return duration;
        }
        return null;
    }

    /**
     * 带时间戳的日志输出
     */
    log(message, duration = null) {
        const timestamp = this.getTimestamp();
        if (duration !== null) {
            console.log(`[${timestamp}] ${message} (用时: ${duration}ms)`);
        } else {
            console.log(`[${timestamp}] ${message}`);
        }
    }

    /**
     * 带时间戳的警告日志
     */
    logWarn(message, duration = null) {
        const timestamp = this.getTimestamp();
        if (duration !== null) {
            console.warn(`[${timestamp}] ${message} (用时: ${duration}ms)`);
        } else {
            console.warn(`[${timestamp}] ${message}`);
        }
    }

    /**
     * 带时间戳的错误日志
     */
    logError(message, duration = null) {
        const timestamp = this.getTimestamp();
        if (duration !== null) {
            console.error(`[${timestamp}] ${message} (用时: ${duration}ms)`);
        } else {
            console.error(`[${timestamp}] ${message}`);
        }
    }

    /**
     * 使用自定义代理抓取文章
     * @param {string} url - 文章URL
     * @param {Object} options - 配置选项
     * @returns {Object} 抓取结果
     */
    async scrapeWithProxy(url, options = {}) {
        const {
            sessionName,
            sessionTTL,
            proxyURL,
            sessionRecording,
            formats
        } = options;

        const currentSessionName = `${sessionName}_custom_proxy`;

        let browser = null;

        try {
            // 连接到 Scrapeless Browser（使用自定义代理）
            this.startStep('connect');
            this.log(`✅ 正在连接到 Scrapeless Browser (自定义代理: ${proxyURL})...`);
            browser = await Puppeteer.connect({
                apiKey: this.apiKey,
                sessionName: currentSessionName,
                sessionTTL: sessionTTL,
                proxyURL: proxyURL,  // 使用自定义代理
                sessionRecording: sessionRecording,
                defaultViewport: null
            });

            this.log('✅ 浏览器连接成功', this.endStep('connect'));

            // 创建新页面
            const page = await browser.newPage();

            // 反检测措施
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 设置额外的 HTTP headers
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            });

            // 设置视口大小
            await page.setViewport({ width: 1280, height: 800 });

            this.startStep('navigate');
            this.log('✅ 正在导航到页面...');

            // 导航到目标页面（带重试逻辑）
            let retries = 3;
            while (retries > 0) {
                try {
                    await page.goto(url, {
                        waitUntil: 'networkidle0',
                        timeout: 60000
                    });
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) {
                        throw error;
                    }
                    this.logWarn(`⚠️  导航失败，还剩 ${retries} 次重试...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

            this.log('✅ 页面加载完成', this.endStep('navigate'));

            // 等待内容加载
            this.startStep('wait-content');
            await new Promise(resolve => setTimeout(resolve, 3000));
            this.endStep('wait-content');

            // 滚动页面触发懒加载图片
            this.startStep('scroll');
            this.log('📜 滚动页面加载图片...');
            for (let i = 0; i < 5; i++) {
                await page.evaluate((scrollY) => {
                    window.scrollTo(0, scrollY);
                }, 1000 * (i + 1));
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 滚动回顶部
            await page.evaluate(() => window.scrollTo(0, 0));
            await new Promise(resolve => setTimeout(resolve, 1000));

            this.log('✅ 图片加载完成', this.endStep('scroll'));

            // 获取页面HTML
            this.startStep('get-content');
            const htmlContent = await page.content();
            this.log('✅ 获取页面内容成功', this.endStep('get-content'));

            // 处理HTML内容
            this.startStep('process');
            const result = this.processHtmlContent(htmlContent, url, formats);
            this.endStep('process');

            // 关闭浏览器
            this.startStep('close');
            await browser.close();
            this.log('✅ 浏览器已关闭', this.endStep('close'));

            this.log('✅ 抓取完成', this.endStep('total'));

            return result;

        } catch (error) {
            this.logError(`❌ 自定义代理抓取失败: ${error.message}`);
            if (browser) {
                try {
                    await browser.close();
                } catch (closeError) {
                    this.logWarn(`⚠️  关闭浏览器失败: ${closeError.message}`);
                }
            }
            throw error;
        }
    }

    /**
     * 抓取微信公众号文章
     * @param {string} url - 文章URL
     * @param {Object} options - 配置选项
     * @returns {Object} 抓取结果
     */
    async scrapeArticle(url, options = {}) {
        const {
            sessionName = `wechat_${Date.now()}`,
            sessionTTL = 180,
            proxyCountry = 'CN',
            sessionRecording = true,
            formats = ['markdown', 'html'],
            proxyRetries = ['CN', 'HK', 'SG'],  // 代理重试列表
            proxyURL = null  // 自定义代理 URL（可选）
        } = options;

        this.startStep('total');
        this.log(`正在抓取文章: ${url}`);
        this.log(`抓取格式: ${formats.join(', ')}`);

        // 如果设置了自定义代理，不使用代理重试
        if (proxyURL) {
            this.log(`使用自定义代理: ${proxyURL}`);
            return await this.scrapeWithProxy(url, {
                sessionName,
                sessionTTL,
                proxyURL,
                sessionRecording,
                formats
            });
        }

        // 外层循环：尝试不同的代理国家
        let lastError = null;
        for (let proxyIndex = 0; proxyIndex < proxyRetries.length; proxyIndex++) {
            const currentProxy = proxyRetries[proxyIndex];
            const currentSessionName = `${sessionName}_${currentProxy}_${proxyIndex}`;

            if (proxyIndex > 0) {
                this.logWarn(`⚠️  使用代理 ${currentProxy} 重试 (${proxyIndex + 1}/${proxyRetries.length})...`);
            }

            let browser = null;

            try {
                // 连接到 Scrapeless Browser
                this.startStep('connect');
                this.log(`✅ 正在连接到 Scrapeless Browser (代理: ${currentProxy})...`);
                browser = await Puppeteer.connect({
                    apiKey: this.apiKey,
                    sessionName: currentSessionName,
                    sessionTTL: sessionTTL,
                    proxyCountry: currentProxy,
                    sessionRecording: sessionRecording,
                    defaultViewport: null
                });

                this.log('✅ 浏览器连接成功', this.endStep('connect'));

            // 创建新页面
            const page = await browser.newPage();

            // 反检测措施
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 设置额外的 HTTP headers
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            });

            // 设置视口大小
            await page.setViewport({ width: 1280, height: 800 });

            this.startStep('navigate');
            this.log('✅ 正在导航到页面...');

            // 导航到目标页面（带重试逻辑）
            let retries = 3;
            while (retries > 0) {
                try {
                    await page.goto(url, {
                        waitUntil: 'networkidle0',
                        timeout: 60000
                    });
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) {
                        throw error;
                    }
                    this.logWarn(`⚠️  导航失败，还剩 ${retries} 次重试...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

                this.log('✅ 页面加载完成', this.endStep('navigate'));

                // 等待内容加载
                this.startStep('wait-content');
                await new Promise(resolve => setTimeout(resolve, 3000));
                this.endStep('wait-content');

                // 滚动页面触发懒加载图片
                this.startStep('scroll');
                this.log('📜 滚动页面加载图片...');
                for (let i = 0; i < 5; i++) {
                    await page.evaluate((scrollY) => {
                        window.scrollTo(0, scrollY);
                    }, 1000 * (i + 1));
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // 滚动回顶部
                await page.evaluate(() => window.scrollTo(0, 0));
                await new Promise(resolve => setTimeout(resolve, 1000));

                this.log('✅ 图片加载完成', this.endStep('scroll'));

                // 获取页面HTML
                this.startStep('get-content');
                const htmlContent = await page.content();

                this.log('✅ 获取页面内容成功', this.endStep('get-content'));

                // 处理HTML内容
                this.startStep('process');
                const result = this.processHtmlContent(htmlContent, url, formats);
                this.endStep('process');

                // 关闭浏览器
                this.startStep('close');
                await browser.close();
                this.log('✅ 浏览器已关闭', this.endStep('close'));

                this.log('✅ 抓取完成', this.endStep('total'));

                return result;

            } catch (error) {
                lastError = error;
                // 改进错误显示：输出完整的错误对象
                const errorDetails = error?.response?.error || error?.error || error;
                const errorString = typeof errorDetails === 'object'
                    ? JSON.stringify(errorDetails, null, 2)
                    : errorDetails;
                this.logError(`❌ 代理 ${currentProxy} 抓取失败: ${error.message}`);
                this.logError(`详细错误: ${errorString}`);
                if (browser) {
                    try {
                        await browser.close();
                    } catch (closeError) {
                        this.logWarn(`⚠️  关闭浏览器失败: ${closeError.message}`);
                    }
                }

                // 如果不是最后一次尝试，等待后继续
                if (proxyIndex < proxyRetries.length - 1) {
                    this.logWarn(`⚠️  等待 3 秒后使用下一个代理重试...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }

        // 所有代理都失败了
        const totalDuration = this.endStep('total');
        this.logError(`❌ 所有代理尝试均失败`, totalDuration);
        throw lastError || new Error('抓取失败：所有代理尝试均失败');
    }

    /**
     * 处理HTML内容并转换为所需格式
     * @param {string} htmlContent - 原始HTML内容
     * @param {string} url - 文章URL
     * @param {Array} formats - 需要的格式
     * @returns {Object} 处理后的结果
     */
    processHtmlContent(htmlContent, url, formats) {
        const $ = cheerio.load(htmlContent);

        // 提取文章元数据
        this.startStep('extract-metadata');
        const metadata = this.extractMetadata($);
        this.endStep('extract-metadata');

        // 提取文章主体内容
        let articleContent = $('#js_content');
        if (!articleContent.length) {
            articleContent = $('.rich_media_content');
        }

        if (!articleContent.length) {
            this.logWarn('⚠️  未找到文章内容区域');
            return null;
        }

        // 修复懒加载图片
        this.startStep('fix-images');
        this.fixLazyImages(articleContent, $);
        this.endStep('fix-images');

        const result = {
            status: 'completed',
            url: url,
            timestamp: new Date().toISOString(),
            metadata: metadata,
            data: {}
        };

        // 根据需要的格式处理内容
        if (formats.includes('html')) {
            this.startStep('convert-html');
            result.data.html = articleContent.html();
            this.endStep('convert-html');
        }

        if (formats.includes('markdown')) {
            this.startStep('convert-markdown');
            const html = articleContent.html();
            result.data.markdown = this.turndownService.turndown(html);
            this.endStep('convert-markdown');
        }

        return result;
    }

    /**
     * 提取文章元数据（适配 Readwise Reader API）
     * @param {Object} $ - Cheerio 实例
     * @returns {Object} 元数据对象
     */
    extractMetadata($) {
        const metadata = {};

        // 提取标题
        metadata.title = $('#activity-name').text().trim()
            || $('.rich_media_title').text().trim()
            || $('meta[property="og:title"]').attr('content')
            || $('title').text().trim()
            || '';

        // 提取作者
        metadata.author = $('#js_name').text().trim()
            || $('.rich_media_meta_nickname').text().trim()
            || $('meta[name="author"]').attr('content')
            || $('meta[property="og:article:author"]').attr('content')
            || '';

        // 提取发布日期
        const publishDateText = $('#publish_time').text().trim()
            || $('.rich_media_meta_text').text().trim()
            || $('meta[property="article:published_time"]').attr('content')
            || '';

        if (publishDateText) {
            // 尝试解析日期
            metadata.published_date = this.parsePublishDate(publishDateText);
        } else {
            metadata.published_date = '';
        }
        this.log(`parsePublishDate: ${publishDateText} -> ${metadata.published_date}`);

        // 来源标记
        metadata.saved_using = 'wechat-scraper-mcp';

        this.log('📋 提取到的元数据:');
        this.log(`  标题: ${metadata.title || '(未找到)'}`);
        this.log(`  作者: ${metadata.author || '(未找到)'}`);
        this.log(`  发布日期: ${metadata.published_date || '(未找到)'}`);

        return metadata;
    }

    /**
     * 解析微信发布日期
     * @param {string} dateText - 日期文本
     * @returns {string} ISO 8601 格式的日期
     */
    parsePublishDate(dateText) {
        try {
            if (!dateText) return '';

            // 预处理：去除无关前缀，规范空白
            let text = String(dateText)
                .trim()
                .replace(/(?:发布时间[:：]?|发布于|北京时间)/g, '')
                .replace(/\s+/g, ' ');

            // 1) 直接支持带时区的 ISO/RFC3339（包含 Z 或 +08:00 或 +0800），允许 T 或 空格 分隔
            // 示例：2025-10-29T16:21:00+0800 或 2025-10-29 16:21:00+08:00 或 2025-10-29T08:21:00Z
            const isoTzMatch = text.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:?\d{2})/i);
            if (isoTzMatch) {
                // 规范化成浏览器/Node 可解析的形式：空格->T，+0800 -> +08:00
                let isoLike = isoTzMatch[0].replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
                const d = new Date(isoLike);
                if (!isNaN(d.getTime())) return d.toISOString();
            }

            // 2) 中文日期（可选年份）+ 可选 上午/下午/AM/PM + 时间
            // 示例：2025年10月29日 下午 4:21 / 10月29日 16:21
            const cnMatch = text.match(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日\s*(?:([上下]午|AM|PM)\s*)?(\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?/i);
            if (cnMatch) {
                let [, year, month, day, ampm = '', hour = '0', minute = '0', second = '0'] = cnMatch;
                const y = year || String(new Date().getFullYear());
                let h = parseInt(hour, 10);
                if (/(下午|PM)/i.test(ampm) && h < 12) h += 12;
                if (/(上午|AM)/i.test(ampm) && h === 12) h = 0;
                const m = String(parseInt(month, 10)).padStart(2, '0');
                const d = String(parseInt(day, 10)).padStart(2, '0');
                const mm = String(parseInt(minute, 10)).padStart(2, '0');
                const ss = String(parseInt(second, 10)).padStart(2, '0');
                const withTz = `${y}-${m}-${d}T${String(h).padStart(2, '0')}:${mm}:${ss}+08:00`;
                const dt = new Date(withTz);
                if (!isNaN(dt.getTime())) return dt.toISOString();
            }

            // 3) 标准日期：YYYY-MM-DD [T|空格] HH:mm[:ss] + 可选 上午/下午/AM/PM
            // 示例：2025-10-29 16:21, 2025-10-29T4:21 PM
            const stdMatch = text.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([上下]午|AM|PM))?/i);
            if (stdMatch) {
                let [, year, month, day, hour, minute, second = '00', ampm = ''] = stdMatch;
                let h = parseInt(hour, 10);
                if (/(下午|PM)/i.test(ampm) && h < 12) h += 12;
                if (/(上午|AM)/i.test(ampm) && h === 12) h = 0;
                const withTz = `${year}-${month}-${day}T${String(h).padStart(2, '0')}:${minute}:${second}+08:00`;
                const dt = new Date(withTz);
                if (!isNaN(dt.getTime())) return dt.toISOString();
            }

            // 4) 兜底：仅日期（YYYY-MM-DD）或日期+时间（无时区），默认按东八区处理
            const fallbackMatch = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
            if (fallbackMatch) {
                const [, year, month, day, hour = '00', minute = '00', second = '00'] = fallbackMatch;
                const withTz = `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
                const dt = new Date(withTz);
                if (!isNaN(dt.getTime())) return dt.toISOString();
            }
        } catch (error) {
            this.logWarn(`⚠️  日期解析失败: ${error.message}`);
        }
        return '';
    }

    /**
     * 修复懒加载图片，替换SVG占位符为真实图片URL
     * @param {Object} articleContent - Cheerio 选择器对象
     * @param {Object} $ - Cheerio 实例
     */
    fixLazyImages(articleContent, $) {
        const images = articleContent.find('img');
        let fixedCount = 0;

        images.each((_i, img) => {
            const $img = $(img);
            const src = $img.attr('src') || '';

            // 检查是否是SVG占位符
            if (src.includes('data:image/svg+xml')) {
                // 尝试从data-src属性获取真实图片URL
                const realSrc = $img.attr('data-src')
                    || $img.attr('data-original')
                    || $img.attr('data-lazy-src');

                if (realSrc) {
                    $img.attr('src', realSrc);
                    fixedCount++;
                    this.log(`  ✅ 修复图片: ${realSrc.substring(0, 80)}...`);
                } else {
                    // 如果没有找到真实URL，尝试从其他属性中查找
                    const attrs = Object.keys($img.attr());
                    for (const attr of attrs) {
                        if (attr.startsWith('data-') && $img.attr(attr).startsWith('http')) {
                            $img.attr('src', $img.attr(attr));
                            fixedCount++;
                            this.log(`  ✅ 修复图片 (从${attr}): ${$img.attr(attr).substring(0, 80)}...`);
                            break;
                        }
                    }
                }
            }
        });

        if (fixedCount > 0) {
            this.log(`📸 共修复 ${fixedCount} 张图片`);
        } else {
            this.log('⚠️  未发现需要修复的懒加载图片');
        }
    }

    /**
     * 保存抓取结果到文件
     * @param {Object} result - 抓取结果
     * @param {string} outputFile - 输出文件名
     */
    async saveResult(result, outputFile) {
        try {
            this.startStep('save');
            // 保存完整结果为JSON
            await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf-8');
            this.log(`📄 完整结果已保存到: ${outputFile}`);

            const data = result.data || {};

            // 如果有markdown内容，单独保存
            if (data.markdown) {
                const markdownFile = outputFile.replace('.json', '.md');
                await fs.writeFile(markdownFile, data.markdown, 'utf-8');
                this.log(`📝 Markdown内容已保存到: ${markdownFile}`);
            }

            // 如果有HTML内容，单独保存
            if (data.html) {
                const htmlFile = outputFile.replace('.json', '.html');
                await fs.writeFile(htmlFile, data.html, 'utf-8');
                this.log(`🌐 HTML内容已保存到: ${htmlFile}`);
            }

            this.log('✅ 所有文件保存完成', this.endStep('save'));

        } catch (error) {
            this.logError(`❌ 保存文件时出错: ${error.message}`, this.endStep('save'));
            throw error;
        }
    }
}

// 主函数
async function main() {
    // 目标URL
    const url = 'https://mp.weixin.qq.com/s/umG_UtpfpEG5riNzfjvpwA';

    // 检查API token (支持两种环境变量名)
    const apiKey = process.env.SCRAPELESS_API_KEY || process.env.SCRAPELESS_API_TOKEN;
    if (!apiKey) {
        console.error('错误: 请设置SCRAPELESS_API_KEY或SCRAPELESS_API_TOKEN环境变量');
        console.error('例如: export SCRAPELESS_API_KEY="your_api_key_here"');
        process.exit(1);
    }

    try {
        // 创建抓取器
        const scraper = new WeChatArticleScraper(apiKey);

        // 生成输出文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const outputFile = `wechat_article_${timestamp}.json`;

        // 抓取文章
        const result = await scraper.scrapeArticle(url, {
            sessionName: 'wechat_opencut_article',
            formats: ['markdown', 'html']
        });

        if (result) {
            console.log('\n🎉 抓取成功!');

            // 保存结果
            await scraper.saveResult(result, outputFile);

            // 显示部分内容预览
            if (result.data.markdown) {
                const preview = result.data.markdown.substring(0, 500);
                console.log(`\n📖 内容预览:\n${preview}...`);
            }
        } else {
            console.error('❌ 抓取失败');
            process.exit(1);
        }

    } catch (error) {
        console.error(`❌ 执行失败: ${error.message}`);
        process.exit(1);
    }
}

// 导出类供其他模块使用
export { WeChatArticleScraper };

// 如果直接运行此文件，则执行main函数
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
