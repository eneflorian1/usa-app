const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    address: String,
    phone: String,
    email: String,
    birthDate: String,
    cardNumber: String,
    cardExpiry: String,
    cardCvv: String,
    cardHolder: String,
    billingAddress: String,
    paymentAddress: String,
    language: { type: String, default: 'ro' },
    theme: { type: String, default: 'system' },
    accounts: [{ platform: String, username: String }],
}, { timestamps: true });

module.exports = mongoose.model('Profile', profileSchema);
