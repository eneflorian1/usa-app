const mongoose = require('mongoose');

/**
 * Knowledge Base Service
 * Provides RAG capabilities for all agents by querying a structured MongoDB collection.
 */

async function searchKnowledge(query, category = null, limit = 10) {
    const KnowledgeEntry = mongoose.model('KnowledgeEntry');

    const filter = {};

    // Text search using regex (case-insensitive)
    if (query) {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { key: { $regex: escapedQuery, $options: 'i' } },
            { value: { $regex: escapedQuery, $options: 'i' } },
            { category: { $regex: escapedQuery, $options: 'i' } },
            { tags: { $regex: escapedQuery, $options: 'i' } }
        ];
    }

    if (category) {
        filter.category = { $regex: category, $options: 'i' };
    }

    const entries = await KnowledgeEntry.find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit);

    return entries;
}

/**
 * Get context for a specific agent type from knowledge base
 * Returns formatted string to inject into system prompt
 */
async function getContextForAgent(agentType) {
    const KnowledgeEntry = mongoose.model('KnowledgeEntry');

    // Get all relevant entries for this agent type
    const entries = await KnowledgeEntry.find({
        $or: [
            { availableTo: agentType },
            { availableTo: 'all' },
            { availableTo: { $exists: false } }
        ]
    }).sort({ category: 1, key: 1 });

    if (entries.length === 0) return '';

    // Format as structured context
    let context = '\n\n--- KNOWLEDGE BASE (date actualizate din baza de date) ---\n';
    let currentCategory = '';

    for (const entry of entries) {
        if (entry.category !== currentCategory) {
            currentCategory = entry.category;
            context += `\n[${currentCategory.toUpperCase()}]\n`;
        }
        context += `• ${entry.key}: ${entry.value}\n`;
    }

    context += '--- END KNOWLEDGE BASE ---\n';
    context += 'IMPORTANT: Folosește exclusiv aceste date pentru răspunsuri despre prețuri, servicii, stocuri. Nu inventa informații.\n';

    return context;
}

/**
 * Get or update user profile from conversation
 */
async function getUserProfile(sessionId) {
    const AgentChat = mongoose.model('AgentChat');
    const chat = await AgentChat.findOne({ sessionId });
    return chat?.userProfile || {};
}

async function updateUserProfile(sessionId, profileData) {
    const AgentChat = mongoose.model('AgentChat');
    await AgentChat.findOneAndUpdate(
        { sessionId },
        { $set: { userProfile: profileData } },
        { upsert: true }
    );
}

/**
 * Summarize conversation when it gets too long
 * Compresses older messages into a summary to save context window
 */
async function summarizeConversationIfNeeded(sessionId, model) {
    const AgentChat = mongoose.model('AgentChat');
    const chat = await AgentChat.findOne({ sessionId });

    if (!chat || chat.messages.length < 40) return null;

    // Take the first 30 messages and summarize them
    const oldMessages = chat.messages.slice(0, 30);
    const msgText = oldMessages.map(m => `${m.role}: ${m.content}`).join('\n');

    try {
        const result = await model.generateContent(
            `Rezumă această conversație în maximum 200 de cuvinte, menținând informațiile cheie (nume client, preferințe, ce a cerut, ce s-a rezolvat):\n\n${msgText}`
        );
        const summary = result.response.text();

        // Keep only the last 10 messages + the summary
        chat.summary = (chat.summary || '') + '\n' + summary;
        chat.messages = chat.messages.slice(30);
        chat.updatedAt = Date.now();
        await chat.save();

        return summary;
    } catch (err) {
        console.error('Failed to summarize conversation:', err);
        return null;
    }
}

/**
 * Extract user profile information from AI response
 */
function extractUserProfile(text) {
    const match = text.match(/<USER_PROFILE>([\s\S]*?)<\/USER_PROFILE>/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].trim());
    } catch {
        return null;
    }
}

function cleanProfileTags(text) {
    return text.replace(/<USER_PROFILE>[\s\S]*?<\/USER_PROFILE>/g, '').trim();
}

module.exports = {
    searchKnowledge,
    getContextForAgent,
    getUserProfile,
    updateUserProfile,
    summarizeConversationIfNeeded,
    extractUserProfile,
    cleanProfileTags
};
