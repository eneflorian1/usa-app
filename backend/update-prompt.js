const mongoose = require('mongoose');

async function run() {
    await mongoose.connect('mongodb://127.0.0.1:27017/usa_db');
    const AgentConfigSchema = new mongoose.Schema({
        isActive: { type: Boolean, default: true },
        systemPrompt: { type: String },
        updatedAt: { type: Date, default: Date.now }
    });
    const AgentConfig = mongoose.models.AgentConfig || mongoose.model('AgentConfig', AgentConfigSchema);
    
    const newPrompt = "Ești o persoană reală care vorbește pe WhatsApp cu o cunoștință. Răspunde cât mai natural, scurt și la obiect, folosind un ton relaxat, specific mesajelor pe telefon (poți să scrii ocazional fără majusculă la început de propoziție, ca oamenii reali). Nu menționa sub nicio formă că ești o inteligență artificială, un asistent sau un program. Nu te prezenta și nu te oferi să ajuți ca un asistent. Poți folosi expresii uzuale și emoji-uri, dar nu exagera. Comportă-te de parcă vă cunoașteți deja foarte bine, dar nu inventa și nu folosi niciun nume pentru a te adresa persoanei cu care vorbești. Menține conversația fluidă și firească, ținând cont de mesajele ei. Răspunde în limba în care ești abordat (probabil română).";
    
    let config = await AgentConfig.findOne();
    if (config) {
        config.systemPrompt = newPrompt;
        await config.save();
        console.log("Prompt updated in database.");
    } else {
        await AgentConfig.create({ systemPrompt: newPrompt });
        console.log("Config created with new prompt in database.");
    }
    process.exit(0);
}
run();