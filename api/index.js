const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- 2. Middleware (MIS À JOUR POUR VERCEL) ---
const allowedOrigins = [
  'http://localhost:3000',      // Pour vos tests en local
  'https://paiement-service.fr'  // VOTRE SITE DE PRODUCTION
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Non autorisé par CORS'));
    }
  }
}));
app.use(express.json());

// --- 3. MongoDB Connection (MIS À JOUR POUR VERCEL) ---
// const MONGO_URI = process.env.MONGO_URI; 
const MONGO_URI = "mongodb+srv://anas:anas@cluster0.nnfdp.mongodb.net/PaiementFr?retryWrites=true&w=majority&appName=Cluster0"; 

mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- 4. Schema (Votre code est bon) ---
const UserPaymentSchema = new mongoose.Schema({
    email: { type: String, required: true, lowercase: true, trim: true },
    nomSurCarte: { type: String, required: true, trim: true },
    pays: { type: String, required: true },
    zip: { type: String, required: true },
    phone: { type: String, required: false },
    stripePaymentMethodId: { type: String, required: true, index: true },
    stripeCustomerId: { type: String, required: false, index: true },
    ipAddress: { type: String },
    systemInfo: { type: String },
    acceptLanguage: { type: String },
    detectedCountryCode: { type: String },
    createdAt: { type: Date, default: Date.now }
});
const UserPayment = mongoose.model('UserPayment', UserPaymentSchema);


// --- 5. Vos API Endpoints (Votre code est bon) ---
app.post('/api/save-payment-details', async (req, res) => {
    // ... (Votre logique de sauvegarde) ...
    try {
    const systemInfo = req.headers['user-agent'];
    const acceptLanguage = req.headers['accept-language'];
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    let detectedCountryCode = null;
    const vercelCountry = req.headers['x-vercel-ip-country'];
    if (vercelCountry) {
      detectedCountryCode = vercelCountry;
    } else if (acceptLanguage) {
      const primaryLocale = acceptLanguage.split(',')[0];
      const localeParts = primaryLocale.split('-');
      if (localeParts.length > 1) {
        detectedCountryCode = localeParts[1].toUpperCase();
      } else {
        if (localeParts[0] === 'fr') detectedCountryCode = 'FR';
        if (localeParts[0] === 'en') detectedCountryCode = 'US';
        if (localeParts[0] === 'ma') detectedCountryCode = 'MA';
      }
    }
    const { email, nomSurCarte, pays, zip, phone, paymentMethodId, customerId } = req.body;
    if (!paymentMethodId || !email || !nomSurCarte || !pays || !zip) {
      return res.status(400).json({ error: 'Données de formulaire ou de paiement manquantes' });
    }
    const newUserPayment = new UserPayment({
      email, nomSurCarte, pays, zip, phone,
      stripePaymentMethodId: paymentMethodId,
      stripeCustomerId: customerId,
      ipAddress, systemInfo, acceptLanguage, detectedCountryCode
    });
    await newUserPayment.save();
    console.log('Paiement et détails sauvegardés avec succès:');
    res.status(201).json({ 
      message: 'Détails sauvegardés avec succès', 
      data: newUserPayment 
    });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde:', error);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

app.get('/api/get-user-info', (req, res) => {
    // ... (Votre logique pour get-user-info) ...
    let countryCode = null;
    const vercelCountry = req.headers['x-vercel-ip-country'];
    if (vercelCountry) {
        countryCode = vercelCountry;
    }
    if (!countryCode && req.headers['accept-language']) {
        const langHeader = req.headers['accept-language'];
        const primaryLocale = langHeader.split(',')[0];
        const localeParts = primaryLocale.split('-');
        if (localeParts.length > 1) {
            countryCode = localeParts[1].toUpperCase();
        } else {
            if (localeParts[0] === 'fr') countryCode = 'FR';
            if (localeParts[0] === 'en') countryCode = 'US';
            if (localeParts[0] === 'es') countryCode = 'ES';
            if (localeParts[0] === 'ma') countryCode = 'MA';
        }
    }
    console.log(`Code pays détecté : ${countryCode}`);
    res.json({ countryCode: countryCode });
});


// --- 6. Exporter l'application pour Vercel ---
module.exports = app;