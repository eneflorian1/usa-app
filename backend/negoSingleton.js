/**
 * Shared NegoOrchestratorService singleton + mission persistence wiring.
 *
 * Both `routes/nego.js` and the main `orchestrator/handlers.js` (NEGOTIATOR
 * tool) import this module so they share the same in-memory mission state.
 */
const mongoose = require('mongoose');
const NegoOrchestratorService = require('./negoOrchestratorService');
const DomainStrategy = require('./scraping/domainStrategy');

const orchestrator = new NegoOrchestratorService();
const domainStrategy = new DomainStrategy();

async function persistMission(mission) {
  try {
    const NegoMission = mongoose.model('NegoMission');
    await NegoMission.updateOne(
      { id: mission.id },
      { $set: {
        id: mission.id,
        userId: 'default',
        url: mission.url,
        query: mission.query,
        domain: mission.domain,
        status: mission.status,
        phases: mission.phases,
        listings: mission.listings,
        reveals: mission.reveals,
        phones: mission.phones,
        summary: mission.summary,
        leadsFound: mission.listings?.length || 0,
        leadsContacted: mission.phones?.length || 0,
        progress: mission.phases?.revealing?.progress || (mission.status === 'completed' ? 100 : 0),
        error: mission.error,
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
      } },
      { upsert: true }
    );
  } catch (err) {
    console.error('[NegoSingleton] persistMission failed:', err.message);
  }
}

orchestrator.on('mission:updated', persistMission);
orchestrator.on('mission:completed', persistMission);
orchestrator.on('mission:error', persistMission);

module.exports = { orchestrator, domainStrategy, persistMission };
