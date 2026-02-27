const mongoose = require('mongoose');
const { generateEmbedding, findMostSimilar } = require('./embeddingService');

/**
 * Object Tracking Service
 * Tracks house objects from glasses camera scans, detects displacements,
 * and creates cleanup task batches when 5+ objects are out of place.
 */

const DISPLACEMENT_BATCH_THRESHOLD = 5;

// ===================== OBJECT LEARNING =====================

/**
 * Learn a new house object or update an existing one.
 * Called when user says "ține minte că X stă pe Y" or registers manually.
 */
async function learnObject(name, description, expectedLocation, imageDescription = '') {
    const HouseObject = mongoose.model('HouseObject');

    // Generate embedding for semantic matching
    const searchText = `${name} ${description} ${imageDescription}`.trim();
    const embedding = await generateEmbedding(searchText);

    // Check if object already exists
    const existing = await findMostSimilar(searchText, 'HouseObject', 'embedding', {}, 0.8);

    if (existing) {
        // Update existing object
        const obj = await HouseObject.findByIdAndUpdate(existing.doc._id, {
            name: name || existing.doc.name,
            description: description || existing.doc.description,
            expectedLocation,
            imageDescription: imageDescription || existing.doc.imageDescription,
            embedding,
            lastSeen: new Date(),
            lastSeenLocation: expectedLocation
        }, { new: true });
        console.log(`[ObjectTracker] Updated existing object: "${obj.name}" → "${expectedLocation}"`);
        return { action: 'updated', object: obj };
    }

    // Create new object
    const obj = await HouseObject.create({
        name,
        description,
        expectedLocation,
        imageDescription,
        embedding,
        lastSeen: new Date(),
        lastSeenLocation: expectedLocation
    });
    console.log(`[ObjectTracker] Learned new object: "${name}" at "${expectedLocation}"`);
    return { action: 'created', object: obj };
}

// ===================== SCAN PROCESSING =====================

/**
 * Process a batch of scanned objects from Gemini vision.
 * For each object, check if it's known and if it's been displaced.
 * @param {Array<{name: string, location: string, description: string}>} scannedObjects
 */
async function processObjectScan(scannedObjects) {
    if (!scannedObjects || scannedObjects.length === 0) return;

    const HouseObject = mongoose.model('HouseObject');
    const DisplacedObject = mongoose.model('DisplacedObject');
    const results = { matched: 0, displaced: 0, unknown: 0 };

    for (const scanned of scannedObjects) {
        try {
            const searchText = `${scanned.name} ${scanned.description || ''}`.trim();
            const match = await findMostSimilar(searchText, 'HouseObject', 'embedding', {}, 0.65);

            if (!match) {
                results.unknown++;
                continue;
            }

            const knownObject = match.doc;
            results.matched++;

            // Update last seen
            await HouseObject.findByIdAndUpdate(knownObject._id, {
                lastSeen: new Date(),
                lastSeenLocation: scanned.location
            });

            // Check if displaced (location differs from expected)
            const isDisplaced = !locationsMatch(knownObject.expectedLocation, scanned.location);

            if (isDisplaced) {
                // Check if we already have a pending displacement for this object
                const existingDisplacement = await DisplacedObject.findOne({
                    houseObjectId: knownObject._id,
                    status: 'pending'
                });

                if (!existingDisplacement) {
                    await DisplacedObject.create({
                        houseObjectId: knownObject._id,
                        objectName: knownObject.name,
                        expectedLocation: knownObject.expectedLocation,
                        foundLocation: scanned.location
                    });

                    await HouseObject.findByIdAndUpdate(knownObject._id, {
                        $inc: { timesDisplaced: 1 }
                    });

                    results.displaced++;
                    console.log(`[ObjectTracker] Displaced: "${knownObject.name}" expected="${knownObject.expectedLocation}" found="${scanned.location}"`);
                }
            }
        } catch (err) {
            console.error(`[ObjectTracker] Error processing "${scanned.name}":`, err.message);
        }
    }

    // Check if we need to notify
    if (results.displaced > 0) {
        await checkAndCreateBatch();
    }

    console.log(`[ObjectTracker] Scan results: ${results.matched} matched, ${results.displaced} displaced, ${results.unknown} unknown`);
    return results;
}

/**
 * Simple location matching — checks if two locations are roughly the same.
 * Uses substring matching and common word overlap.
 */
function locationsMatch(expected, found) {
    if (!expected || !found) return false;

    const normalize = (s) => s.toLowerCase()
        .replace(/[^a-zA-ZăâîșțĂÂÎȘȚ0-9\s]/g, '')
        .trim();

    const a = normalize(expected);
    const b = normalize(found);

    // Exact match or one contains the other
    if (a === b || a.includes(b) || b.includes(a)) return true;

    // Word overlap check (>50% words overlap = same location)
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    let overlap = 0;
    for (const w of wordsA) {
        if (wordsB.has(w) && w.length > 2) overlap++;
    }
    const minSize = Math.min(wordsA.size, wordsB.size);
    return minSize > 0 && (overlap / minSize) > 0.5;
}

// ===================== BATCH NOTIFICATIONS =====================

/**
 * Check if we have enough pending displaced objects to create a cleanup batch.
 */
async function checkAndCreateBatch() {
    const DisplacedObject = mongoose.model('DisplacedObject');
    const CleanupBatch = mongoose.model('CleanupBatch');

    const pendingDisplaced = await DisplacedObject.find({ status: 'pending' });

    if (pendingDisplaced.length >= DISPLACEMENT_BATCH_THRESHOLD) {
        // Check if there's already a pending batch
        const existingBatch = await CleanupBatch.findOne({ status: 'pending' });
        if (existingBatch) {
            // Update existing batch with new displaced objects
            const existingIds = existingBatch.displacedObjects.map(id => id.toString());
            const newIds = pendingDisplaced
                .map(d => d._id)
                .filter(id => !existingIds.includes(id.toString()));

            if (newIds.length > 0) {
                existingBatch.displacedObjects.push(...newIds);
                existingBatch.notifiedAt = new Date();
                await existingBatch.save();
                console.log(`[ObjectTracker] Updated batch ${existingBatch._id} with ${newIds.length} new items`);
            }
            return existingBatch;
        }

        // Create new batch
        const batch = await CleanupBatch.create({
            displacedObjects: pendingDisplaced.map(d => d._id)
        });
        console.log(`[ObjectTracker] 🔔 Created cleanup batch ${batch._id} with ${pendingDisplaced.length} objects`);
        return batch;
    }

    return null;
}

/**
 * Approve a cleanup batch — creates planner tasks for each displaced object.
 */
async function approveBatch(batchId) {
    const CleanupBatch = mongoose.model('CleanupBatch');
    const DisplacedObject = mongoose.model('DisplacedObject');
    const PlannerTask = mongoose.model('PlannerTask');

    const batch = await CleanupBatch.findById(batchId).populate('displacedObjects');
    if (!batch || batch.status !== 'pending') {
        throw new Error('Batch not found or already processed');
    }

    const tasks = [];
    for (const displaced of batch.displacedObjects) {
        if (displaced.status !== 'pending') continue;

        const task = await PlannerTask.create({
            title: `🏠 Pune "${displaced.objectName}" la loc`,
            description: `Obiectul "${displaced.objectName}" a fost găsit la "${displaced.foundLocation}" dar ar trebui să fie la "${displaced.expectedLocation}".`,
            priority: 'low',
            dueDate: new Date()
        });
        tasks.push(task);

        displaced.status = 'added_to_calendar';
        await displaced.save();
    }

    batch.status = 'approved';
    await batch.save();

    console.log(`[ObjectTracker] ✅ Batch ${batchId} approved — created ${tasks.length} tasks`);
    return { tasks, batch };
}

/**
 * Dismiss a cleanup batch — marks all displaced objects as resolved.
 */
async function dismissBatch(batchId) {
    const CleanupBatch = mongoose.model('CleanupBatch');
    const DisplacedObject = mongoose.model('DisplacedObject');

    const batch = await CleanupBatch.findById(batchId);
    if (!batch || batch.status !== 'pending') {
        throw new Error('Batch not found or already processed');
    }

    await DisplacedObject.updateMany(
        { _id: { $in: batch.displacedObjects } },
        { status: 'resolved' }
    );

    batch.status = 'dismissed';
    await batch.save();

    console.log(`[ObjectTracker] ❌ Batch ${batchId} dismissed`);
    return batch;
}

// ===================== CONTEXT FOR PROMPT =====================

/**
 * Get a compact summary of tracked objects for inclusion in system prompt.
 */
async function getObjectTrackingContext() {
    const Setting = mongoose.model('Setting');
    const toggle = await Setting.findOne({ key: 'object_tracking_enabled' });
    if (!toggle || toggle.value !== 'true') return '';

    const HouseObject = mongoose.model('HouseObject');
    const objects = await HouseObject.find().sort({ lastSeen: -1 }).limit(30).lean();

    if (objects.length === 0) return '';

    let context = '\n\n--- OBIECTE KNOWN ÎN CASĂ ---\n';
    for (const obj of objects) {
        context += `• ${obj.name}: loc normal="${obj.expectedLocation}"`;
        if (obj.lastSeenLocation && obj.lastSeenLocation !== obj.expectedLocation) {
            context += ` (ultima dată văzut la "${obj.lastSeenLocation}")`;
        }
        context += '\n';
    }
    context += '--- END OBIECTE ---\n';
    return context;
}

module.exports = {
    learnObject,
    processObjectScan,
    checkAndCreateBatch,
    approveBatch,
    dismissBatch,
    getObjectTrackingContext
};
