const mongoose = require('mongoose');
const { getGeminiModel } = require('./configService');

async function generateReply(incomingMessage, senderPhone) {
    try {
        const AgentConfig = mongoose.model('AgentConfig');
        const config = await AgentConfig.findOne() || await AgentConfig.create({});
        
        if (!config.isActive) {
            console.log('Agent is currently disabled.');
            return null;
        }

        const model = await getGeminiModel(config.systemPrompt);
        if (!model) {
            console.error('Cannot generate reply because Gemini model is not available (API key may be missing).');
            return null;
        }
        
        // Fetch Conversation History
        const Conversation = mongoose.model('Conversation');
        let convo = await Conversation.findOne({ phoneNumber: senderPhone });
        if (!convo) {
            convo = await Conversation.create({ phoneNumber: senderPhone, messages: [] });
        }

        // Format history for Gemini
        // We limit to the last 20 messages for context window
        const recentMessages = convo.messages.slice(-20);
        const history = recentMessages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        const chat = model.startChat({ history });

        // Generate response
        const result = await chat.sendMessage(incomingMessage);
        const responseText = result.response.text();

        // Save to Database
        convo.messages.push({ role: 'user', content: incomingMessage });
        convo.messages.push({ role: 'model', content: responseText });
        convo.updatedAt = Date.now();
        await convo.save();

        return responseText;
    } catch (error) {
        console.error('Error generating reply from Gemini:', error);
        return null;
    }
}

async function callGemini(prompt, systemInstruction = '') {
    try {
        const model = await getGeminiModel(systemInstruction);
        if (!model) throw new Error('Gemini model not available');
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('[Gemini] callGemini failed:', error.message);
        throw error;
    }
}

module.exports = {
    generateReply,
    callGemini
};