const mongoose = require('mongoose');

// Import all models
require('./Item');
require('./Setting');
require('./AgentConfig');
require('./Conversation');
require('./Booking');
require('./AgentChat');
require('./KnowledgeEntry');
require('./Escalation');
require('./GlassesMemory');
require('./PlannerTask');
require('./HouseObject');
require('./DisplacedObject');
require('./CleanupBatch');
require('./LocalExecCommand');
require('./CodingSession');
require('./ProjectMemory');
require('./GitRepo');
require('./GitRepoTask');
require('./WebAgentSession');
require('./CronJob');
require('./CronJobLog');
require('./UgcReferenceImage');
require('./UgcGeneration');
require('./UgcVideoGeneration');
require('./UgcProduct');
require('./EmailThread');
require('./EmailAgentConfig');
require('./ProductResume');
require('./OrchestratorMemory');
require('./NegoLead');
require('./NegoMission');
require('./NegoMessage');
require('./NegoConfig');
require('./Profile');

// Re-export all models for convenience
module.exports = {
  Item: mongoose.model('Item'),
  Setting: mongoose.model('Setting'),
  AgentConfig: mongoose.model('AgentConfig'),
  Conversation: mongoose.model('Conversation'),
  Booking: mongoose.model('Booking'),
  AgentChat: mongoose.model('AgentChat'),
  KnowledgeEntry: mongoose.model('KnowledgeEntry'),
  Escalation: mongoose.model('Escalation'),
  GlassesMemory: mongoose.model('GlassesMemory'),
  PlannerTask: mongoose.model('PlannerTask'),
  HouseObject: mongoose.model('HouseObject'),
  DisplacedObject: mongoose.model('DisplacedObject'),
  CleanupBatch: mongoose.model('CleanupBatch'),
  LocalExecCommand: mongoose.model('LocalExecCommand'),
  CodingSession: mongoose.model('CodingSession'),
  ProjectMemory: mongoose.model('ProjectMemory'),
  GitRepo: mongoose.model('GitRepo'),
  GitRepoTask: mongoose.model('GitRepoTask'),
  WebAgentSession: mongoose.model('WebAgentSession'),
  CronJob: mongoose.model('CronJob'),
  CronJobLog: mongoose.model('CronJobLog'),
  UgcReferenceImage: mongoose.model('UgcReferenceImage'),
  UgcGeneration: mongoose.model('UgcGeneration'),
  UgcVideoGeneration: mongoose.model('UgcVideoGeneration'),
  UgcProduct: mongoose.model('UgcProduct'),
  EmailThread: mongoose.model('EmailThread'),
  EmailAgentConfig: mongoose.model('EmailAgentConfig'),
  ProductResume: mongoose.model('ProductResume'),
  OrchestratorMemory: mongoose.model('OrchestratorMemory'),
  NegoLead: mongoose.model('NegoLead'),
  NegoMission: mongoose.model('NegoMission'),
  NegoMessage: mongoose.model('NegoMessage'),
  NegoConfig: mongoose.model('NegoConfig'),
  Profile: mongoose.model('Profile'),
};
