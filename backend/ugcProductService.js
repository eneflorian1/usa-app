const { GoogleGenAI } = require('@google/genai');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Ensure output directory exists
const OUTPUT_DIR = path.join(__dirname, 'ugc-output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Default system prompt for Visual Bible generation
const DEFAULT_VISUAL_BIBLE_PROMPT = `You have been given a brand's images.

Create a visual guide that can be used to produce more visuals in the style of this brand.

Break down the aesthetic into actionable pillars:

1. **The Aesthetic** - Describe the overall visual identity, mood, and feel
2. **Lighting & Atmosphere** - Lighting style, direction, mood (hard/soft, natural/artificial, color temperature)
3. **Subject Matter & Styling** - How models/subjects should look, wardrobe, accessories, body language
4. **Texture & Details** - Surface textures, environmental details, sensory elements
5. **Product Integration** - How the product appears in scenes (hero vs prop, interaction style, placement)
6. **Composition & Framing** - Camera angles, crop styles, POV choices
7. **Post-Processing & Editing** - Color grading, grain, film emulation, imperfections

Be extremely specific and detailed. Reference specific images when describing patterns.
Output in a structured, readable format with headers and bullet points.`;

// System prompt for UGC content generation with product
const UGC_PRODUCT_GENERATION_PROMPT = `You are an advanced AI UGC (User Generated Content) photo generation agent specialized in product promotion.

YOUR ROLE:
You receive:
1. PRODUCT IMAGES - Photos of the actual product to be promoted
2. VISUAL BIBLE - A detailed style guide describing the brand's visual identity
3. SCENE DESCRIPTION - What the user wants in the generated image

YOUR TASK:
Generate a NEW photorealistic image that:
- Features the EXACT product from the product images (same packaging, branding, colors, shape)
- Follows the visual style described in the Visual Bible (lighting, composition, texture, mood)
- Matches the scene description provided by the user
- Looks like authentic UGC content, not a staged commercial shoot

GENERATION RULES:
- The image must be PHOTOREALISTIC — it should look like a real photograph
- The product must be clearly recognizable and accurately represented
- Follow the Visual Bible's guidelines for lighting, composition, and styling
- The product should be naturally integrated into the scene (not floating or unnaturally placed)
- If a person is mentioned, they should look natural and authentic
- Maintain the brand's aesthetic identity throughout

OUTPUT: Generate the requested photorealistic image and provide a brief description of what you created.`;

async function getApiKey() {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) {
        throw new Error('Gemini API key not configured. Please set it in Settings.');
    }
    return setting.value;
}

/**
 * Generate a Visual Bible from reference images
 * @param {string} systemPrompt - Custom system prompt for the Visual Bible
 * @param {{ data: string, mimeType: string }[]} referenceImages - Base64 reference images
 * @returns {string} Visual Bible text
 */
async function generateVisualBible(systemPrompt, referenceImages) {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const contents = [];

    // System prompt
    contents.push({ text: systemPrompt || DEFAULT_VISUAL_BIBLE_PROMPT });

    // Reference images
    contents.push({ text: `Here are ${referenceImages.length} brand reference images. Analyze them carefully to understand the visual identity and style:` });

    for (let i = 0; i < referenceImages.length; i++) {
        contents.push({ text: `Image ${i + 1}:` });
        contents.push({
            inlineData: {
                mimeType: referenceImages[i].mimeType || 'image/jpeg',
                data: referenceImages[i].data,
            },
        });
    }

    contents.push({ text: 'Now create the comprehensive Visual Bible / Style Guide based on these images.' });

    console.log(`[UGC Product] Generating Visual Bible with ${referenceImages.length} reference images...`);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
    });

    let visualBible = '';

    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
        for (const part of response.candidates[0].content.parts) {
            if (part.text) {
                visualBible += part.text;
            }
        }
    }

    if (!visualBible) {
        throw new Error('No Visual Bible was generated. The model may have encountered an error.');
    }

    console.log(`[UGC Product] Visual Bible generated: ${visualBible.length} chars`);
    return visualBible;
}

/**
 * Generate UGC content for a product
 * @param {{ data: string, mimeType: string }[]} productImages - Product photos
 * @param {string} visualBible - The Visual Bible text
 * @param {string} scenePrompt - User's scene description
 * @param {{ aspectRatio?: string }} options
 * @returns {{ imageData: string, description: string, filePath: string, filename: string }}
 */
async function generateProductUGC(productImages, visualBible, scenePrompt, options = {}) {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const contents = [];

    // System prompt
    contents.push({ text: UGC_PRODUCT_GENERATION_PROMPT });

    // Product images
    contents.push({ text: `Here are the PRODUCT images. Study the product's packaging, branding, colors, and shape carefully:` });
    for (let i = 0; i < productImages.length; i++) {
        contents.push({
            inlineData: {
                mimeType: productImages[i].mimeType || 'image/jpeg',
                data: productImages[i].data,
            },
        });
    }

    // Visual Bible
    if (visualBible) {
        contents.push({ text: `VISUAL BIBLE (Style Guide):\n${visualBible}` });
    }

    // Scene prompt
    contents.push({
        text: `Now generate a new photorealistic UGC image based on these instructions. The product must be accurately represented and the style must match the Visual Bible.\n\nScene description: ${scenePrompt}`
    });

    const config = {
        responseModalities: ['TEXT', 'IMAGE'],
    };

    const imageConfig = {};
    if (options.aspectRatio && options.aspectRatio !== 'auto') imageConfig.aspectRatio = options.aspectRatio;
    if (Object.keys(imageConfig).length > 0) {
        config.imageConfig = imageConfig;
    }

    console.log(`[UGC Product] Generating UGC image with ${productImages.length} product image(s)...`);
    console.log(`[UGC Product] Scene: ${scenePrompt.substring(0, 100)}...`);

    const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: contents,
        config: config,
    });

    let imageData = null;
    let description = '';

    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
        for (const part of response.candidates[0].content.parts) {
            if (part.text) {
                description += part.text;
            } else if (part.inlineData) {
                imageData = part.inlineData.data;
            }
        }
    }

    if (!imageData) {
        throw new Error('No image was generated. The model may have refused the request or encountered an error.' + (description ? ` Model said: ${description}` : ''));
    }

    // Save to file
    const filename = `ugc_product_${Date.now()}.png`;
    const filePath = path.join(OUTPUT_DIR, filename);
    const buffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(filePath, buffer);
    console.log(`[UGC Product] Image saved: ${filePath}`);

    return {
        imageData,
        description,
        filePath,
        filename,
    };
}

/**
 * Generate N different scene prompts based on the Visual Bible and product
 * @param {string} visualBible - The visual bible text
 * @param {number} count - Number of prompts to generate
 * @returns {Promise<string[]>} Array of prompts
 */
async function generateScenePrompts(visualBible, count = 10) {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const promptText = `You are an expert creative director. 
I have a brand with the following VISUAL BIBLE / Style Guide:
${visualBible}

Your task is to generate EXACTLY ${count} different, highly detailed photorealistic scene descriptions (prompts) to feature our product.
Each prompt must place the product in a unique, visually stunning scenario (e.g., different angles, backgrounds, lighting conditions, environments, lifestyle contexts, or interactions).
The prompts must strictly adhere to the Visual Bible's aesthetic, lighting, and composition rules.

Output ONLY a raw JSON array of strings containing the prompts. Do NOT include markdown formatting or backticks.
Example:
[
  "Product resting on a slick wet stone next to a calm lake at dawn, cinematic blue hour lighting, soft mist in the background, deep focus, Sony A7R IV 35mm lens",
  "Close up macro shot of the product held by a model with elegant hands against a minimal studio pastel background, soft diffused lighting, high fashion photography"
]`;

    console.log(`[UGC Product] Generating ${count} scene prompts...`);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ text: promptText }],
    });

    let text = response.text || (response.candidates && response.candidates[0] && response.candidates[0].content.parts[0].text) || '[]';
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        const prompts = JSON.parse(text);
        if (Array.isArray(prompts)) return prompts;
        throw new Error("Result is not an array");
    } catch (e) {
        console.error("Failed to parse prompt JSON:", text);
        return [
            "Photorealistic high quality shot of the product, commercial lighting, clean background",
            "Lifestyle shot showing the product in a natural environment"
        ]; // Fallback
    }
}

module.exports = {
    generateVisualBible,
    generateProductUGC,
    generateScenePrompts,
    DEFAULT_VISUAL_BIBLE_PROMPT,
};
