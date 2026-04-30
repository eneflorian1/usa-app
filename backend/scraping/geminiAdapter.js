/**
 * GeminiAdapter — wraps backend's configService.getGeminiModel() into the
 * NegoApp GeminiClient interface used by SiteIntelligence and the orchestrator.
 *
 * Exposes:
 *   - isAvailable          (boolean — true unless explicitly disabled)
 *   - generate(prompt, opts)
 *   - analyzePageStructure(html, domain)
 *
 * The actual API key validity is checked lazily inside `generate()`; if it's
 * missing, configService throws and we surface the error to the caller.
 */
const { getGeminiModel } = require('../configService');

class GeminiAdapter {
  constructor() {
    this.isAvailable = true;
  }

  async generate(prompt, { systemPrompt, temperature = 0.7, maxTokens = 2048 } = {}) {
    const model = await getGeminiModel(systemPrompt);
    if (!model) throw new Error('Gemini model unavailable');
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    });
    return result.response.text();
  }

  /**
   * Quick page-structure analysis used by SiteIntelligence.quickAnalyze().
   * Returns the parsed JSON object Gemini gives back, or the raw text on
   * parse failure.
   */
  async analyzePageStructure(html, domain) {
    const prompt = `Analyze this marketplace page from ${domain} and return a JSON describing the visible structure (sections, key selectors, contact mechanisms). HTML:\n${html}`;
    const raw = await this.generate(prompt, { temperature: 0.2, maxTokens: 2048 });
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { raw };
    }
  }
}

module.exports = GeminiAdapter;
