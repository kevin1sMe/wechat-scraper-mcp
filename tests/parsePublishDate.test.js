import assert from 'node:assert/strict';
import { WeChatArticleScraper } from '../scraper.js';

function isoAtBeijing(y, m, d, hh = 0, mm = 0, ss = 0) {
  const year = String(y).padStart(4, '0');
  const month = String(m).padStart(2, '0');
  const day = String(d).padStart(2, '0');
  const hour = String(hh).padStart(2, '0');
  const minute = String(mm).padStart(2, '0');
  const second = String(ss).padStart(2, '0');
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`).toISOString();
}

// Instantiate with a dummy API key; parsePublishDate does not use network
const scraper = new WeChatArticleScraper('test');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

// 1) Chinese date without AM/PM
test('CN: 2025年10月29日 16:21 → 2025-10-29T08:21:00.000Z', () => {
  const input = '2025年10月29日 16:21';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 16, 21, 0);
  assert.equal(out, expected);
});

// 2) Chinese date with 下午
test('CN: 2025年10月29日 下午 4:21 → 2025-10-29T08:21:00.000Z', () => {
  const input = '2025年10月29日 下午 4:21';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 16, 21, 0);
  assert.equal(out, expected);
});

// 3) Chinese date with 上午 12:xx → 00:xx
test('CN: 2025年10月29日 上午 12:21 → 2025-10-28T16:21:00.000Z', () => {
  const input = '2025年10月29日 上午 12:21';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 0, 21, 0);
  assert.equal(out, expected);
});

// 4) Chinese date with 下午 12:xx → 12:xx
test('CN: 2025年10月29日 下午 12:21 → 2025-10-29T04:21:00.000Z', () => {
  const input = '2025年10月29日 下午 12:21';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 12, 21, 0);
  assert.equal(out, expected);
});

// 5) ISO with +0800
test('ISO: 2025-10-29T16:21:00+0800 → 2025-10-29T08:21:00.000Z', () => {
  const input = '2025-10-29T16:21:00+0800';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 16, 21, 0);
  assert.equal(out, expected);
});

// 6) ISO with +08:00, with space
test('ISO: 2025-10-29 16:21:00+08:00 → 2025-10-29T08:21:00.000Z', () => {
  const input = '2025-10-29 16:21:00+08:00';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 16, 21, 0);
  assert.equal(out, expected);
});

// 7) Plain standard without timezone → assume +08:00
test('STD: 2025-10-29 16:21 → 2025-10-29T08:21:00.000Z', () => {
  const input = '2025-10-29 16:21';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 16, 21, 0);
  assert.equal(out, expected);
});

// 8) Without time → assume 00:00 +08
test('Date only: 2025-10-29 → 2025-10-28T16:00:00.000Z', () => {
  const input = '2025-10-29';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 0, 0, 0);
  assert.equal(out, expected);
});

// 9) With Beijing prefix
test('Prefix: 北京时间 2025-10-29 16:21 → 2025-10-29T08:21:00.000Z', () => {
  const input = '北京时间 2025-10-29 16:21';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(2025, 10, 29, 16, 21, 0);
  assert.equal(out, expected);
});

// 10) ISO Zulu (already UTC)
test('Zulu: 2025-10-29T08:21:00Z → 2025-10-29T08:21:00.000Z', () => {
  const input = '2025-10-29T08:21:00Z';
  const out = scraper.parsePublishDate(input);
  assert.equal(out, '2025-10-29T08:21:00.000Z');
});

// 11) Chinese without year (uses current year)
test('CN no year: 10月29日 16:21 → currentYear-10-29T08:21:00.000Z', () => {
  const currentYear = new Date().getFullYear();
  const input = '10月29日 16:21';
  const out = scraper.parsePublishDate(input);
  const expected = isoAtBeijing(currentYear, 10, 29, 16, 21, 0);
  assert.equal(out, expected);
});

// 12) Invalid input
test('Invalid: abc → empty string', () => {
  const input = 'abc';
  const out = scraper.parsePublishDate(input);
  assert.equal(out, '');
});

console.log(`\nTests finished. Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);

