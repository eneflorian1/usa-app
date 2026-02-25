const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

async function getGeminiModel(systemInstruction) {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    
    if (!setting || !setting.value) {
        throw new Error('Gemini API key not configured');
    }
    
    // Explicitly initialize the genAI client with the retrieved API key
    const genAI = new GoogleGenerativeAI(setting.value);
    
    // Explicitly set systemInstruction as part of the model configuration
    return genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash-lite',
        systemInstruction: systemInstruction 
    });
}

async function generateReply(incomingMessage, senderPhone) {
    try {
        const AgentConfig = mongoose.model('AgentConfig');
        const config = await AgentConfig.findOne() || await AgentConfig.create({});
        
        if (!config.isActive) {
            console.log('Agent is currently disabled.');
            return null;
        }

        const model = await getGeminiModel(config.systemPrompt);
        
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

module.exports = {
    generateReply
};