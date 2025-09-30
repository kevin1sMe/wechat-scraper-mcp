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
            formats = ['markdown', 'html']
        } = options;

        console.log(`正在抓取文章: ${url}`);
        console.log(`抓取格式: ${formats.join(', ')}`);

        let browser = null;

        try {
            // 连接到 Scrapeless Browser
            console.log('✅ 正在连接到 Scrapeless Browser...');
            browser = await Puppeteer.connect({
                apiKey: this.apiKey,
                sessionName: sessionName,
                sessionTTL: sessionTTL,
                proxyCountry: proxyCountry,
                sessionRecording: sessionRecording,
                defaultViewport: null
            });

            console.log('✅ 浏览器连接成功');

            // 创建新页面
            const page = await browser.newPage();

            // 设置视口大小
            await page.setViewport({ width: 1280, height: 800 });

            console.log('✅ 正在导航到页面...');

            // 导航到目标页面
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 60000
            });

            console.log('✅ 页面加载完成');

            // 等待内容加载
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 滚动页面触发懒加载图片
            console.log('📜 滚动页面加载图片...');
            for (let i = 0; i < 5; i++) {
                await page.evaluate((scrollY) => {
                    window.scrollTo(0, scrollY);
                }, 1000 * (i + 1));
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 滚动回顶部
            await page.evaluate(() => window.scrollTo(0, 0));
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log('✅ 图片加载完成');

            // 获取页面HTML
            const htmlContent = await page.content();

            console.log('✅ 获取页面内容成功');

            // 处理HTML内容
            const result = this.processHtmlContent(htmlContent, url, formats);

            // 关闭浏览器
            await browser.close();
            console.log('✅ 浏览器已关闭');

            return result;

        } catch (error) {
            console.error(`❌ 抓取异常: ${error.message}`);
            if (browser) {
                await browser.close();
            }
            throw error;
        }
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
        const metadata = this.extractMetadata($);

        // 提取文章主体内容
        let articleContent = $('#js_content');
        if (!articleContent.length) {
            articleContent = $('.rich_media_content');
        }

        if (!articleContent.length) {
            console.warn('⚠️  未找到文章内容区域');
            return null;
        }

        // 修复懒加载图片
        this.fixLazyImages(articleContent, $);

        const result = {
            status: 'completed',
            url: url,
            timestamp: new Date().toISOString(),
            metadata: metadata,
            data: {}
        };

        // 根据需要的格式处理内容
        if (formats.includes('html')) {
            result.data.html = articleContent.html();
        }

        if (formats.includes('markdown')) {
            const html = articleContent.html();
            result.data.markdown = this.turndownService.turndown(html);
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

        // 提取公众号名称
        metadata.account = $('#js_name').text().trim()
            || $('.rich_media_meta_nickname').text().trim()
            || '';

        // 提取发布日期
        const publishDateText = $('#publish_time').text().trim()
            || $('.rich_media_meta_text').text().trim()
            || $('meta[property="article:published_time"]').attr('content')
            || '';

        if (publishDateText) {
            // 尝试解析日期
            metadata.published_date = this.parsePublishDate(publishDateText);
        }

        // 提取封面图片
        metadata.image_url = $('meta[property="og:image"]').attr('content')
            || $('#js_content img').first().attr('src')
            || $('#js_content img').first().attr('data-src')
            || '';

        // 提取摘要/描述
        metadata.summary = $('meta[name="description"]').attr('content')
            || $('meta[property="og:description"]').attr('content')
            || '';

        // 如果没有摘要，从文章内容中提取前200字
        if (!metadata.summary) {
            const contentText = $('#js_content').text().trim();
            metadata.summary = contentText.substring(0, 200).replace(/\s+/g, ' ');
        }

        // 设置文档类型
        metadata.category = 'article';

        // 来源标记
        metadata.saved_using = 'wechat-scraper-mcp';

        console.log('📋 提取到的元数据:');
        console.log(`  标题: ${metadata.title || '(未找到)'}`);
        console.log(`  作者: ${metadata.author || '(未找到)'}`);
        console.log(`  公众号: ${metadata.account || '(未找到)'}`);
        console.log(`  发布日期: ${metadata.published_date || '(未找到)'}`);

        return metadata;
    }

    /**
     * 解析微信发布日期
     * @param {string} dateText - 日期文本
     * @returns {string} ISO 8601 格式的日期
     */
    parsePublishDate(dateText) {
        try {
            // 尝试匹配中文日期格式: "2025年09月30日 12:10"
            const chineseMatch = dateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{1,2}))?/);
            if (chineseMatch) {
                const [, year, month, day, hour = '00', minute = '00'] = chineseMatch;
                const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00+08:00`;
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }

            // 尝试匹配标准格式: "2023-01-01" 或 "2023-01-01 12:00"
            const standardMatch = dateText.match(/(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/);
            if (standardMatch) {
                const dateStr = standardMatch[1];
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }
        } catch (error) {
            console.warn(`⚠️  日期解析失败: ${error.message}`);
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
                    console.log(`  ✅ 修复图片: ${realSrc.substring(0, 80)}...`);
                } else {
                    // 如果没有找到真实URL，尝试从其他属性中查找
                    const attrs = Object.keys($img.attr());
                    for (const attr of attrs) {
                        if (attr.startsWith('data-') && $img.attr(attr).startsWith('http')) {
                            $img.attr('src', $img.attr(attr));
                            fixedCount++;
                            console.log(`  ✅ 修复图片 (从${attr}): ${$img.attr(attr).substring(0, 80)}...`);
                            break;
                        }
                    }
                }
            }
        });

        if (fixedCount > 0) {
            console.log(`📸 共修复 ${fixedCount} 张图片`);
        } else {
            console.log('⚠️  未发现需要修复的懒加载图片');
        }
    }

    /**
     * 保存抓取结果到文件
     * @param {Object} result - 抓取结果
     * @param {string} outputFile - 输出文件名
     */
    async saveResult(result, outputFile) {
        try {
            // 保存完整结果为JSON
            await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf-8');
            console.log(`📄 完整结果已保存到: ${outputFile}`);

            const data = result.data || {};

            // 如果有markdown内容，单独保存
            if (data.markdown) {
                const markdownFile = outputFile.replace('.json', '.md');
                await fs.writeFile(markdownFile, data.markdown, 'utf-8');
                console.log(`📝 Markdown内容已保存到: ${markdownFile}`);
            }

            // 如果有HTML内容，单独保存
            if (data.html) {
                const htmlFile = outputFile.replace('.json', '.html');
                await fs.writeFile(htmlFile, data.html, 'utf-8');
                console.log(`🌐 HTML内容已保存到: ${htmlFile}`);
            }

        } catch (error) {
            console.error(`❌ 保存文件时出错: ${error.message}`);
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