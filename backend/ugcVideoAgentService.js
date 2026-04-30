const { GoogleGenAI } = require('@google/genai');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Ensure output directory exists
const OUTPUT_DIR = path.join(__dirname, 'ugc-output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// System prompt for analyzing reference images
const ANALYSIS_SYSTEM_PROMPT = `You are an expert AI visual analyst specializing in human appearance analysis for UGC (User Generated Content) video generation.

YOUR TASK:
Carefully study ALL provided reference images of a person and produce a DETAILED analysis of their appearance.

ANALYZE AND DESCRIBE:
1. FACIAL FEATURES: Face shape, eye color/shape, skin tone, hair color/style/length, eyebrow shape, nose shape, lip shape, facial hair (if any), distinctive features (moles, freckles, scars, dimples).
2. BODY PROPORTIONS: Body type (athletic, slim, muscular, curvy, etc.), apparent height, shoulder width, overall build.
3. AGE & ETHNICITY: Estimated age range, apparent ethnicity/background.
4. STYLE: Typical clothing style observed, accessories, makeup style (if applicable), general aesthetic.
5. DISTINGUISHING CHARACTERISTICS: Anything unique that makes this person recognizable - tattoos, piercings, birthmarks, specific mannerisms visible in photos.

OUTPUT FORMAT:
Provide a comprehensive, structured description that could be used to consistently recreate this person's appearance in AI-generated videos. Be extremely precise and detailed. Write in English.`;

// System prompt for building video generation prompts
const VIDEO_PROMPT_SYSTEM = `You are an expert AI video prompt engineer for Veo 3.1 (Google's video generation model).

YOUR ROLE:
You receive a detailed description of a person's appearance AND user instructions for the desired video scene. You must create an optimal video generation prompt that will produce a photorealistic video featuring that exact person.

RULES:
1. Incorporate ALL distinctive physical features from the person's description into the prompt to ensure identity consistency.
2. Follow user instructions PRECISELY for: body position/pose, background/setting, action/movement, clothing, lighting, camera angle, mood/atmosphere.
3. Write the prompt in a cinematic, descriptive style that Veo 3.1 responds well to.
4. Include specific details about: camera movement, lighting quality, time of day, environment details, the person's expression and motion.
5. Keep the person description naturally woven into the scene description — don't list features mechanically.
6. The prompt should read like a professional film director's shot description.
7. Always specify that the video should be PHOTOREALISTIC and CINEMATIC.
8. If audio/dialogue is mentioned by the user, include natural ambient sounds or speech direction.

OUTPUT: Return ONLY the optimized video generation prompt, nothing else. No explanations, no headers, just the prompt text.`;

const { getApiKey: getConfigApiKey } = require('./configService');

async function getApiKey() {
    return getConfigApiKey('gemini_api_key');
}

/**
 * Analyze reference images and produce a detailed description of the person
 * @param {{ data: string, mimeType: string }[]} referenceImages - Base64 reference images
 * @returns {string} Detailed text description of the person
 */
async function analyzeReferenceImages(referenceImages) {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const contents = [];
    contents.push({ text: ANALYSIS_SYSTEM_PROMPT });
    contents.push({ text: `Here are ${referenceImages.length} reference images of the person. Analyze them thoroughly:` });

    for (const img of referenceImages) {
        contents.push({
            inlineData: {
                mimeType: img.mimeType || 'image/jpeg',
                data: img.data,
            },
        });
    }

    contents.push({ text: 'Now provide your detailed analysis of this person\'s appearance.' });

    console.log(`[UGC Video Agent] Analyzing ${referenceImages.length} reference image(s)...`);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
    });

    let analysis = '';
    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
        for (const part of response.candidates[0].content.parts) {
            if (part.text) analysis += part.text;
        }
    }

    if (!analysis) {
        throw new Error('Failed to analyze reference images. No analysis text returned.');
    }

    console.log(`[UGC Video Agent] Analysis complete (${analysis.length} chars)`);
    return analysis;
}

/**
 * Build an optimized video prompt by combining person analysis with user instructions
 * @param {string} personAnalysis - Detailed description of the person
 * @param {string} userInstructions - What the user wants in the video
 * @returns {string} Optimized video generation prompt
 */
async function buildVideoPrompt(personAnalysis, userInstructions) {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `${VIDEO_PROMPT_SYSTEM}

PERSON DESCRIPTION:
${personAnalysis}

USER'S VIDEO INSTRUCTIONS:
${userInstructions}

Generate the optimal Veo 3.1 video prompt now:`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ text: prompt }],
    });

    let videoPrompt = '';
    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
        for (const part of response.candidates[0].content.parts) {
            if (part.text) videoPrompt += part.text;
        }
    }

    if (!videoPrompt) {
        throw new Error('Failed to build video prompt.');
    }

    console.log(`[UGC Video Agent] Video prompt built (${videoPrompt.length} chars)`);
    return videoPrompt.trim();
}

/**
 * Generate a video using Veo 3.1
 * @param {string} prompt - The optimized video generation prompt
 * @param {{ data: string, mimeType: string }[]} referenceImages - Base64 reference images (max 3)
 * @param {{ aspectRatio?: string, duration?: string }} options
 * @returns {{ videoFilename: string, videoPath: string }}
 */
async function generateVideo(prompt, referenceImages = [], options = {}) {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const config = {
        personGeneration: 'allow_adult',
    };

    if (options.aspectRatio) config.aspectRatio = options.aspectRatio;
    if (options.duration) config.durationSeconds = options.duration;

    // Add reference images (max 3 supported by Veo 3.1)
    if (referenceImages.length > 0) {
        const refs = referenceImages.slice(0, 3).map(img => ({
            image: {
                imageBytes: img.data,
                mimeType: img.mimeType || 'image/jpeg',
            },
            referenceType: 'asset',
        }));
        config.referenceImages = refs;
    }

    console.log(`[UGC Video Agent] Starting Veo 3.1 video generation...`);
    console.log(`[UGC Video Agent] Prompt: ${prompt.substring(0, 150)}...`);
    console.log(`[UGC Video Agent] Config: ratio=${options.aspectRatio || '16:9'}, duration=${options.duration || '8'}s, refs=${referenceImages.length}`);

    let operation = await ai.models.generateVideos({
        model: 'veo-3.1-generate-preview',
        prompt: prompt,
        config: config,
    });

    // Poll until done (max ~6 min)
    const maxPolls = 40; // 40 * 10s = ~6.5 min
    let pollCount = 0;

    while (!operation.done && pollCount < maxPolls) {
        console.log(`[UGC Video Agent] Polling... (${pollCount + 1}/${maxPolls})`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation });
        pollCount++;
    }

    if (!operation.done) {
        throw new Error('Video generation timed out after ~6 minutes. Please try again.');
    }

    if (!operation.response || !operation.response.generatedVideos || operation.response.generatedVideos.length === 0) {
        throw new Error('No video was generated. The model may have refused the request or encountered a safety filter.');
    }

    // Download and save
    const filename = `ugc_video_${Date.now()}.mp4`;
    const filePath = path.join(OUTPUT_DIR, filename);

    await ai.files.download({
        file: operation.response.generatedVideos[0].video,
        downloadPath: filePath,
    });

    console.log(`[UGC Video Agent] Video saved: ${filePath}`);

    return {
        videoFilename: filename,
        videoPath: filePath,
    };
}

/**
 * Full pipeline: analyze + build prompt + generate video
 * @param {string} userInstructions - User's description of desired video
 * @param {{ data: string, mimeType: string }[]} referenceImages - Reference images
 * @param {{ aspectRatio?: string, duration?: string }} options
 * @param {function} onStatusUpdate - Callback for status updates (optional)
 * @returns {{ analysis: string, videoPrompt: string, videoFilename: string, videoPath: string }}
 */
async function generateUGCVideo(userInstructions, referenceImages, options = {}, onStatusUpdate = null) {
    const update = (status) => {
        console.log(`[UGC Video Agent] ${status}`);
        if (onStatusUpdate) onStatusUpdate(status);
    };

    // Step 1: Analyze reference images
    update('Analyzing reference images...');
    const analysis = await analyzeReferenceImages(referenceImages);

    // Step 2: Build optimized video prompt
    update('Building optimized video prompt...');
    const videoPrompt = await buildVideoPrompt(analysis, userInstructions);

    // Step 3: Generate video with Veo 3.1
    update('Generating video with Veo 3.1 (this may take 1-6 minutes)...');
    const result = await generateVideo(videoPrompt, referenceImages, options);

    update('Video generation complete!');

    return {
        analysis,
        videoPrompt,
        videoFilename: result.videoFilename,
        videoPath: result.videoPath,
    };
}

module.exports = {
    analyzeReferenceImages,
    buildVideoPrompt,
    generateVideo,
    generateUGCVideo,
};
