const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const { getApiKey } = require('./configService');

/**
 * Embedding Service
 * Generates vector embeddings using Gemini text-embedding-004
 */

const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;

let cachedGenAI = null;

async function getGenAI() {
    if (cachedGenAI) return cachedGenAI;
    const apiKey = await getApiKey('gemini_api_key');
    cachedGenAI = new GoogleGenerativeAI(apiKey);
    return cachedGenAI;
}

/**
 * Generate a 768-dimensional embedding vector for a text string.
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} - 768-dim float array
 */
async function generateEmbedding(text) {
    if (!text || text.trim().length === 0) {
        return new Array(EMBEDDING_DIMENSIONS).fill(0);
    }

    const genAI = await getGenAI();
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text.trim());
    return result.embedding.values;
}

/**
 * Generate embeddings for multiple texts in one batch.
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} - Array of 768-dim vectors
 */
async function generateEmbeddings(texts) {
    if (!texts || texts.length === 0) return [];

    const genAI = await getGenAI();
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

    const results = [];
    for (const text of texts) {
        if (!text || text.trim().length === 0) {
            results.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
            continue;
        }
        const result = await model.embedContent(text.trim());
        results.push(result.embedding.values);
    }
    return results;
}

/**
 * Calculate cosine similarity between two vectors.
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} - Similarity score between -1 and 1
 */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
}

/**
 * Semantic search on a MongoDB collection using embeddings.
 * Generates an embedding for the query, then computes cosine similarity
 * against all documents with embeddings in the collection.
 * 
 * @param {string} query - Search query text
 * @param {string} collectionName - Mongoose model name
 * @param {string} embeddingField - Field name storing the embedding array
 * @param {Object} filter - Optional MongoDB filter to narrow scope
 * @param {number} limit - Max results to return
 * @param {number} minScore - Minimum similarity score (0-1)
 * @returns {Promise<Array<{doc: Object, score: number}>>}
 */
async function semanticSearch(query, collectionName, embeddingField = 'embedding', filter = {}, limit = 10, minScore = 0.5) {
    const queryEmbedding = await generateEmbedding(query);
    const Model = mongoose.model(collectionName);

    // Get all documents that have embeddings and match the filter
    const docs = await Model.find({
        ...filter,
        [embeddingField]: { $exists: true, $ne: [] }
    }).lean();

    // Calculate similarity scores
    const scored = docs.map(doc => ({
        doc,
        score: cosineSimilarity(queryEmbedding, doc[embeddingField])
    }));

    // Sort by score descending, filter by minimum, limit
    return scored
        .filter(item => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

/**
 * Find the most similar document to a query in a collection.
 * Returns null if no match above minScore.
 */
async function findMostSimilar(query, collectionName, embeddingField = 'embedding', filter = {}, minScore = 0.6) {
    const results = await semanticSearch(query, collectionName, embeddingField, filter, 1, minScore);
    return results.length > 0 ? results[0] : null;
}

module.exports = {
    generateEmbedding,
    generateEmbeddings,
    cosineSimilarity,
    semanticSearch,
    findMostSimilar,
    EMBEDDING_DIMENSIONS
};
