const { logAgent } = require('../services/cassandra');

class BaseAgent {
  constructor(name, options = {}) {
    this.name = name;
    this.maxRetries = options.maxRetries || 3;
  }

  async execute(input) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[Agent:${this.name}] Starting attempt ${attempt}...`);
        const result = await this.run(input);
        
        await this.log('SUCCESS', `Completed in ${attempt} attempt(s)`, { input: typeof input === 'object' ? JSON.stringify(input).substring(0, 500) : input });
        return result;
      } catch (err) {
        lastError = err;
        console.error(`[Agent:${this.name}] Attempt ${attempt} failed:`, err.message);
        
        if (attempt === this.maxRetries) {
          await this.log('ERROR', `Failed after ${this.maxRetries} attempts: ${err.message}`);
          throw err;
        }
        
        // Wait before retry (exponential backoff)
        const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async log(status, message, metadata = {}) {
    try {
      const cassandra = require('../services/cassandra');
      await cassandra.logAgent(this.name, 'execute', status, message, metadata);
    } catch (err) {
      console.error(`[Agent:${this.name}] Failed to write log to Cassandra:`, err.message);
    }
  }

  // To be implemented by subclasses
  async run(input) {
    throw new Error('Method "run" must be implemented');
  }
}

module.exports = BaseAgent;
