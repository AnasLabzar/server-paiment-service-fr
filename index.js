const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// --- 1. Initialize Express ---
const app = express();
const PORT = process.env.PORT || 3001;

// --- 2. Middleware ---
// Allow requests from your React frontend
app.use(cors({ origin: 'http://localhost:3000' }));
// Allow the server to read JSON from the body of requests
app.use(express.json());

// --- 3. MongoDB Connection ---
// !! Replace with your own MongoDB connection string
const MONGO_URI = "mongodb+srv://anas:anas@cluster0.nnfdp.mongodb.net/PaiementFr?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- 4. Define Your Database Schema (Model) ---
// This defines the structure of the data you will save
const UserPaymentSchema = new mongoose.Schema({
    // ---------------------------------
    //  Informations du Formulaire
    // ---------------------------------
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    nomSurCarte: {
        type: String,
        required: true,
        trim: true
    },
    pays: { // Le nom complet, ex: "France"
        type: String,
        required: true
    },
    zip: { // Code postal
        type: String,
        required: true
    },
    phone: { // Vous l'aviez avant, je le garde
        type: String,
        required: false 
    },
    
    // ---------------------------------
    //  Informations de Paiement (Sécurisées)
    // ---------------------------------
    stripePaymentMethodId: {
        type: String,
        required: true, // Requis si c'est un paiement Stripe
        index: true // Bon pour les recherches futures
    },
    stripeCustomerId: {
        type: String,
        required: false,
        index: true
    },
    // Vous pourriez ajouter :
    // paypalOrderId: { type: String, required: false, index: true },

    // ---------------------------------
    //  Informations de Connexion (Headers)
    // ---------------------------------
    ipAddress: {
        type: String
    },
    systemInfo: { // Le 'User-Agent' complet
        type: String
    },
    acceptLanguage: { // Ex: "fr-FR,fr;q=0.9,en-US;q=0.8"
        type: String
    },
    detectedCountryCode: { // Le code pays qu'on a détecté (ex: "MA", "FR")
        type: String
    },

    // ---------------------------------
    //  Horodatage
    // ---------------------------------
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const UserPayment = mongoose.model('UserPayment', UserPaymentSchema);


// --- 5. Create Your API Endpoint ---
// This is the URL your React app will call
app.post('/api/save-payment-details', async (req, res) => {
  try {
    // --- 1. Données des Headers & Connexion ---
    const systemInfo = req.headers['user-agent'];
    const acceptLanguage = req.headers['accept-language'];
    // (Note: req.ip est plus simple si vous configurez "trust proxy")
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // --- 2. Logique pour le pays (identique à l'autre API) ---
    let detectedCountryCode = null;
    const vercelCountry = req.headers['x-vercel-ip-country']; // Pour la production
    
    if (vercelCountry) {
      detectedCountryCode = vercelCountry;
    } else if (acceptLanguage) {
      // Fallback pour localhost
      const primaryLocale = acceptLanguage.split(',')[0];
      const localeParts = primaryLocale.split('-');
      if (localeParts.length > 1) {
        detectedCountryCode = localeParts[1].toUpperCase();
      } else {
        if (localeParts[0] === 'fr') detectedCountryCode = 'FR';
        if (localeParts[0] === 'en') detectedCountryCode = 'US';
      }
    }

    // --- 3. Données du Formulaire (envoyées par React) ---
    const { email, nomSurCarte, pays, zip, phone, paymentMethodId, customerId } = req.body;

    // --- 4. Validation ---
    if (!paymentMethodId || !email || !nomSurCarte || !pays || !zip) {
      return res.status(400).json({ error: 'Données de formulaire ou de paiement manquantes' });
    }

    // --- 5. Créer le nouvel objet à sauvegarder ---
    const newUserPayment = new UserPayment({
      // Formulaire
      email: email,
      nomSurCarte: nomSurCarte,
      pays: pays,
      zip: zip,
      phone: phone,
      
      // Paiement (Token sécurisé)
      stripePaymentMethodId: paymentMethodId,
      stripeCustomerId: customerId,

      // Headers
      ipAddress: ipAddress,
      systemInfo: systemInfo,
      acceptLanguage: acceptLanguage,
      detectedCountryCode: detectedCountryCode
    });

    // --- 6. Sauvegarder dans MongoDB ---
    await newUserPayment.save();

    console.log('Paiement et détails sauvegardés avec succès:');
    console.log(newUserPayment);

    res.status(201).json({ 
      message: 'Détails sauvegardés avec succès', 
      data: newUserPayment 
    });

  } catch (error) {
    console.error('Erreur lors de la sauvegarde:', error);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// Cet endpoint lit les en-têtes de la requête pour deviner le pays
app.get('/api/get-user-info', (req, res) => {
    let countryCode = null;

    // Méthode 1 : (Meilleure) Via les en-têtes de votre hébergeur
    // Sur Vercel, utilisez: req.headers['x-vercel-ip-country']
    // Sur Netlify, utilisez: req.headers['x-country']
    // Sur AWS CloudFront: req.headers['cloudfront-viewer-country']
    // Exemple pour Vercel :
    const vercelCountry = req.headers['x-vercel-ip-country'];
    if (vercelCountry) {
        countryCode = vercelCountry;
    }

    // Méthode 2 : (Fallback) Via la langue du navigateur
    // Moins fiable, 'en-US' ne signifie pas que l'utilisateur est aux USA
    // Mais c'est utile pour les tests en 'localhost'
    if (!countryCode && req.headers['accept-language']) {
        const langHeader = req.headers['accept-language'];
        // Prend la première langue (ex: "fr-FR", "en-US", "es", "fr")
        const primaryLocale = langHeader.split(',')[0];
        const localeParts = primaryLocale.split('-');

        // Prend la partie pays (ex: "FR" dans "fr-FR")
        if (localeParts.length > 1) {
            countryCode = localeParts[1].toUpperCase();
        } else {
            // Si pas de région (ex: "fr"), on fait une supposition
            // Vous pouvez étendre cette logique
            if (localeParts[0] === 'fr') countryCode = 'FR';
            if (localeParts[0] === 'en') countryCode = 'US';
            if (localeParts[0] === 'es') countryCode = 'ES';
            if (localeParts[0] === 'ma') countryCode = 'MA';
        }
    }

    console.log(`Code pays détecté : ${countryCode}`);
    res.json({ countryCode: countryCode });
});


// --- 6. Start the Server ---
app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});