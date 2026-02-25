const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

async function run() {
    await mongoose.connect('mongodb://127.0.0.1:27017/usa_db');
    
    // Quick schema define just to read
    const SettingSchema = new mongoose.Schema({ key: String, value: String });
    const Setting = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
    
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting) {
        console.log("No API key");
        process.exit(1);
    }
    
    const genAI = new GoogleGenerativeAI(setting.value);
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${setting.value}`);
        const data = await response.json();
        console.log(JSON.stringify(data.models.map(m => m.name), null, 2));
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}

run();