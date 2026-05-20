const mongoose = require('mongoose');

const GeoPreferenceSchema = new mongoose.Schema({
    userId: { type: String, default: 'default', index: true },
    type: { type: String, enum: ['preferred_area', 'budget', 'property_filter', 'monitor'], default: 'preferred_area' },
    city: { type: String, default: 'Sibiu' },

    // Zonă rezolvată
    resolved_area: { type: String },
    resolved_area_id: { type: String },
    geo: {
        lat: Number,
        lng: Number,
    },
    radius_km: { type: Number, default: 3 },

    // Filtre imobiliare
    price_min: Number,
    price_max: Number,
    currency: { type: String, default: 'EUR' },
    rooms: [Number],
    area_sqm_min: Number,
    area_sqm_max: Number,
    property_type: { type: String, enum: ['apartment', 'house', 'studio', 'land', 'commercial', 'any'], default: 'any' },

    // Lifestyle tags
    lifestyle_tags: [String],

    // Monitor config
    monitor: {
        active: { type: Boolean, default: false },
        interval_hours: { type: Number, default: 6 },
        whatsapp_chatId: String,
        last_run: Date,
        alert_on_new: { type: Boolean, default: true },
        min_score: { type: Number, default: 6 },
    },

    // Raw text pentru referință
    raw_input: String,

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

GeoPreferenceSchema.index({ userId: 1, type: 1 });

module.exports = mongoose.model('GeoPreference', GeoPreferenceSchema);
