const { GoogleGenAI } = require('@google/genai');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Ensure output directory exists
const OUTPUT_DIR = path.join(__dirname, 'ugc-output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// System prompt instructing the agent how to analyze references and generate
const UGC_SYSTEM_PROMPT = `You are an advanced AI UGC (User Generated Content) photo generation agent.

YOUR ROLE:
You receive reference images of a specific person and study them carefully. Then, based on user instructions, you generate a NEW photorealistic image featuring that exact person in the described context.

ANALYSIS PROCESS (for every generation):
1. FACIAL FEATURES: Study the person's face shape, eye color, skin tone, hair color, hair style, eyebrow shape, nose shape, lip shape, facial hair (if any), and any distinctive features (moles, freckles, scars).
2. BODY PROPORTIONS: Analyze body type, height impression, build (athletic, slim, muscular, etc.), shoulder width, and overall physique visible in the references.
3. STYLE & APPEARANCE: Note their typical clothing style, accessories, and general aesthetic from the reference photos.
4. IDENTITY CONSISTENCY: Ensure the generated person is UNMISTAKABLY the same individual from the references — same face, same proportions, same distinctive features.

GENERATION RULES:
- The generated image must be PHOTOREALISTIC — it should look like a real photograph, not AI-generated art.
- Preserve the person's EXACT facial features, skin tone, and body type from the reference images.
- Follow the user's instructions precisely regarding: body position/pose, background/setting, clothing, lighting, camera angle, mood/atmosphere.
- If the user specifies a scenario (e.g., "on a beach at sunset"), place the person naturally in that environment with correct lighting, shadows, and perspective.
- Maintain natural proportions — the person should look like they naturally belong in the scene.
- Generate only ONE person matching the references unless explicitly told otherwise.

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
 * Generate a UGC image using Gemini Nano Banana 2 (gemini-3.1-flash-image-preview)
 * @param {string} prompt - Text description of desired output
 * @param {{ data: string, mimeType: string }[]} referenceImages - Base64 reference images
 * @param {{ aspectRatio?: string, resolution?: string }} options
 * @returns {{ imageData: string, description: string, filePath: string }}
 */
async function generateImage(prompt, referenceImages = [], options = {}) {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    // Build contents: system instructions + reference images + user prompt
    const contents = [];

    // First: system instruction as text
    contents.push({ text: UGC_SYSTEM_PROMPT });

    // Then: all reference images with context
    contents.push({ text: `Here are ${referenceImages.length} reference images of the person. Study their facial features, body type, skin tone, hair, and distinctive characteristics carefully:` });

    for (let i = 0; i < referenceImages.length; i++) {
        contents.push({
            inlineData: {
                mimeType: referenceImages[i].mimeType || 'image/jpeg',
                data: referenceImages[i].data,
            },
        });
    }

    // Finally: the user's generation instructions
    contents.push({ text: `Now generate a new photorealistic image based on these instructions. The person in the generated image MUST be the same person from the reference images above.\n\nUser instructions: ${prompt}` });

    const config = {
        responseModalities: ['TEXT', 'IMAGE'],
    };

    const imageConfig = {};
    if (options.aspectRatio && options.aspectRatio !== 'auto') imageConfig.aspectRatio = options.aspectRatio;
    if (options.resolution) imageConfig.imageSize = options.resolution;
    if (Object.keys(imageConfig).length > 0) {
        config.imageConfig = imageConfig;
    }

    console.log(`[UGC Agent] Generating image with ${referenceImages.length} reference(s)...`);
    console.log(`[UGC Agent] Prompt: ${prompt.substring(0, 100)}...`);

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
    const filename = `ugc_${Date.now()}.png`;
    const filePath = path.join(OUTPUT_DIR, filename);
    const buffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(filePath, buffer);
    console.log(`[UGC Agent] Image saved: ${filePath}`);

    return {
        imageData,
        description,
        filePath,
        filename,
    };
}

module.exports = { generateImage };
