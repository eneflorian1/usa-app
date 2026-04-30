/**
 * Web Search Service
 * Uses duck-duck-scrape (DuckDuckGo) — no API key, no setup required.
 * Falls back to a custom SearXNG instance if configured in Settings.
 *
 * Settings page: Settings → 🔍 Search Engine
 *   - Leave blank → DuckDuckGo (default, works out of the box)
 *   - Set URL → uses your self-hosted SearXNG instance
 */

const { search, searchNews, SearchTimeType } = require('duck-duck-scrape');
const mongoose = require('mongoose');
const { getApiKey } = require('./configService');

// Map timeRange strings → DuckDuckGo SearchTimeType
const TIME_MAP = {
    day:   SearchTimeType.DAY,
    week:  SearchTimeType.WEEK,
    month: SearchTimeType.MONTH,
    year:  SearchTimeType.YEAR,
    '':    SearchTimeType.ALL,
};

// Rate limit protection — minimum gap between DDG requests
let lastDdgRequest = 0;
const DDG_MIN_INTERVAL_MS = 3000; // 3 seconds

async function ddgRateLimit() {
    const now = Date.now();
    const elapsed = now - lastDdgRequest;
    if (elapsed < DDG_MIN_INTERVAL_MS) {
        await new Promise(r => setTimeout(r, DDG_MIN_INTERVAL_MS - elapsed));
    }
    lastDdgRequest = Date.now();
}

async function getCustomSearxngUrl() {
    try { return await getApiKey('searxng_url'); }
    catch { return null; }
}

/**
 * Execute a search using DuckDuckGo (default) or SearXNG (if configured).
 */
async function executeSearxngSearch({ query, categories = 'general', numResults = 5, timeRange = '' }) {
    if (!query || !query.trim()) {
        return { success: false, error: 'Query gol — nu am ce căuta.' };
    }

    const customUrl = await getCustomSearxngUrl();

    // If custom SearXNG URL configured, use it
    if (customUrl) {
        return searchViaSearxng(customUrl, { query, categories, numResults, timeRange });
    }

    // Default: DuckDuckGo via duck-duck-scrape
    return searchViaDuckDuckGo({ query, categories, numResults, timeRange });
}

// ── DuckDuckGo ───────────────────────────────────────────────────────────────

async function searchViaDuckDuckGo({ query, categories, numResults, timeRange }) {
    const ddgTime = TIME_MAP[timeRange] ?? SearchTimeType.ALL;
    const isNews = categories === 'news';

    console.log(`[Search] DuckDuckGo: "${query.substring(0, 60)}" (${isNews ? 'news' : 'web'}, timeRange: ${timeRange || 'all'})`);

    // Retry once if rate-limited
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await ddgRateLimit();
            let results = [];

            if (isNews) {
                const news = await searchNews(query, { safeSearch: 0 });
                results = (news.results || []).slice(0, numResults).map(r => ({
                    title: r.title || '(fără titlu)',
                    url: r.url || '',
                    snippet: r.excerpt || r.description || '',
                    source: r.source || 'DuckDuckGo News'
                }));
            } else {
                const web = await search(query, { safeSearch: 0, time: ddgTime });
                results = (web.results || []).slice(0, numResults).map(r => ({
                    title: r.title || '(fără titlu)',
                    url: r.url || '',
                    snippet: r.description || '',
                    source: 'DuckDuckGo'
                }));
            }

            console.log(`[Search] DuckDuckGo ✓ — ${results.length} results`);
            return { success: true, query, categories, totalFound: results.length, results, engine: 'DuckDuckGo' };

        } catch (err) {
            const isRateLimit = err.message?.includes('anomaly') || err.message?.includes('too quickly') || err.message?.includes('rate');
            console.warn(`[Search] DuckDuckGo attempt ${attempt} error: ${err.message}`);
            if (isRateLimit && attempt < 2) {
                console.log('[Search] Rate limit hit, waiting 3s before retry...');
                await new Promise(r => setTimeout(r, 3000));
                lastDdgRequest = 0; // reset so next call goes immediately
                continue;
            }
            return { success: false, error: `DuckDuckGo: ${err.message}` };
        }
    }
    return { success: false, error: 'DuckDuckGo: max retries exceeded' };
}

// ── SearXNG fallback (if custom URL set) ─────────────────────────────────────

async function searchViaSearxng(baseUrl, { query, categories, numResults, timeRange }) {
    const { SearxngService } = require('searxng');

    console.log(`[Search] SearXNG (${baseUrl}): "${query.substring(0, 60)}"`);

    try {
        const searxng = new SearxngService({ baseURL: baseUrl });
        const params = {
            query: query.trim(),
            categories: [categories || 'general'],
            format: 'json'
        };
        if (timeRange) params.time_range = timeRange;

        const data = await searxng.search(params);

        if (!data || !Array.isArray(data.results)) {
            return { success: false, error: 'SearXNG nu returnează format JSON valid.' };
        }

        const results = data.results.slice(0, numResults).map(r => ({
            title: r.title || '(fără titlu)',
            url: r.url || '',
            snippet: r.content || '',
            source: r.engine || 'SearXNG'
        }));

        return {
            success: true,
            query,
            categories,
            totalFound: data.results.length,
            results,
            engine: `SearXNG (${baseUrl})`
        };
    } catch (err) {
        console.error('[Search] SearXNG error:', err.message);
        return { success: false, error: `SearXNG (${baseUrl}): ${err.message}` };
    }
}

module.exports = { executeSearxngSearch };
