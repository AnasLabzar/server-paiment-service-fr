// --- 1. Imports and Environment Variables ---
require('dotenv').config(); // Load variables from .env file FIRST
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');   // For signature verification
const nodemailer = require('nodemailer'); // For sending emails
const fs = require('fs');         // For reading email templates

const app = express();

// --- 2. Configuration Variables ---
// Secret Key (Must match WordPress!)
const HMAC_SECRET_KEY = process.env.HMAC_SECRET_KEY || 'A*!zerty@My$ecretPa$$w0rd-1RDV'; // Fallback for safety, replace or remove fallback

// MongoDB URI
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://anas:anas@cluster0.nnfdp.mongodb.net/PaiementFr?retryWrites=true&w=majority&appName=Cluster0"; // Fallback, replace or remove

// Email Configuration
const EMAIL_SERVICE = process.env.EMAIL_SERVICE || 'gmail';
const EMAIL_USER = process.env.EMAIL_USER || 'principeanas80@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'Ikram@20022025';
const EMAIL_FROM = process.env.EMAIL_FROM || '"1RDV Mandat Paiement" <no-reply@paiement-service.fr>';

// --- 3. Middleware ---
const allowedOrigins = [
  'http://localhost:3000',          // For local tests
  'https://paiement-service.fr',    // Your production site
  'https://www.paiement-service.fr' // Production site with www
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS Error: Origin ${origin} not allowed.`); // Log CORS errors
      callback(new Error('Non autorisé par CORS'));
    }
  }
}));
app.use(express.json()); // Middleware to parse JSON bodies

// --- 4. MongoDB Connection ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- 5. Mongoose Schema ---
const UserPaymentSchema = new mongoose.Schema({
    email: { type: String, required: true, lowercase: true, trim: true },
    nomSurCarte: { type: String, required: false, trim: true }, // Made optional as it might not always come
    pays: { type: String, required: false }, // Made optional
    zip: { type: String, required: false }, // Made optional
    stripePaymentMethodId: { type: String, required: true, index: true },
    entry_id: { type: String, required: false, index: true }, // WPForms Entry ID
    total: { type: Number, required: false }, // Amount
    produit: { type: String, required: false }, // Product names
    origin: { type: String, required: false }, // Originating domain
    // Optional fields collected server-side
    ipAddress: { type: String },
    systemInfo: { type: String },
    createdAt: { type: Date, default: Date.now }
});
const UserPayment = mongoose.model('UserPayment', UserPaymentSchema);

// --- 6. Nodemailer Setup ---
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, 
    port: parseInt(process.env.EMAIL_PORT || '587'), // Ensure port is a number
    secure: process.env.EMAIL_SECURE === 'true', // Use true for port 465, false for others
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    // Add this for Ethereal if using self-signed certs (less secure, only for testing)
    // tls: {
    //   rejectUnauthorized: false 
    // }
});

transporter.verify(function(error, success) {
   if (error) {
        console.error("Erreur configuration Nodemailer:", error);
   } else {
        console.log("Nodemailer est prêt à envoyer des emails.");
   }
});

// --- 7. Email Sending Functions ---
async function sendSuccessEmail(orderData) {
    if (!orderData || !orderData.email) {
        console.error("Impossible d'envoyer l'email de succès: données manquantes (email).");
        return;
    }
    try {
        let htmlContent = fs.readFileSync('./templates/email_success_template.html', 'utf8');
        htmlContent = htmlContent
            .replace('{{ORIGIN}}', orderData.origin || 'notre site')
            .replace('{{TOTAL}}', parseFloat(orderData.total || 0).toFixed(2))
            .replace('{{PRODUIT}}', orderData.produit || 'votre commande')
            .replace('{{ENTRY_ID}}', orderData.entry_id || 'N/A');

        const mailOptions = {
            from: EMAIL_FROM,
            to: orderData.email,
            subject: `Confirmation de votre paiement - ${orderData.produit || 'Commande'}`,
            html: htmlContent,
        };
        let info = await transporter.sendMail(mailOptions);
        console.log(`Email de succès envoyé à ${orderData.email}: ${info.messageId}`);
    } catch (emailError) {
        console.error("Erreur lors de l'envoi de l'email de succès:", emailError);
    }
}

async function sendErrorEmail(errorDetails, attemptData) {
    if (!attemptData) {
        console.error("Impossible d'envoyer l'email d'erreur: données de tentative manquantes.");
        return;
    }
    try {
        let htmlContent = fs.readFileSync('./templates/email_error_template.html', 'utf8');
        htmlContent = htmlContent
            .replace('{{ORIGIN}}', attemptData.origin || 'notre site')
            .replace('{{PRODUIT}}', attemptData.produit || 'votre commande')
            .replace('{{ERROR_MESSAGE}}', errorDetails.message || 'Erreur inconnue')
            .replace('{{EMAIL}}', attemptData.email || 'Non fourni');

        const mailOptions = {
            from: EMAIL_FROM,
            // Send to customer AND admin (your email)
            to: `${attemptData.email ? attemptData.email + ',' : ''} ${EMAIL_USER}`,
            subject: `Problème avec votre paiement - ${attemptData.produit || 'Commande'}`,
            html: htmlContent,
        };
        let info = await transporter.sendMail(mailOptions);
        console.log(`Email d'erreur envoyé (tentative pour ${attemptData.email || 'inconnu'}): ${info.messageId}`);
    } catch (emailError) {
        console.error("Erreur lors de l'envoi de l'email d'erreur:", emailError);
    }
}

// --- 8. API Endpoints ---

// Endpoint to verify the order data and signature from the URL
app.post('/api/verify-order', (req, res) => {
    console.log('DEBUG API Verify: Requête reçue à /api/verify-order'); // Log entry
    const { total, produit, email, entry_id, signature, origin } = req.body;

    if (!total || !produit || !email || !entry_id || !signature || !origin) {
        console.warn('DEBUG API Verify: Données manquantes reçues:', req.body); // Log missing data
        return res.status(400).json({ error: "Données manquantes" });
    }
    console.log('DEBUG API Verify: Données reçues OK'); // Log

    // Recreate the exact data string used in WordPress
    const dataString = total + produit + email + entry_id + origin;
    console.log('DEBUG API Verify: Data String pour vérification:', dataString); // Log

    try {
        // Calculate the expected signature
        const expectedSignature = crypto
            .createHmac('sha256', HMAC_SECRET_KEY)
            .update(dataString)
            .digest('hex');
        console.log('DEBUG API Verify: Signature attendue:', expectedSignature); // Log
        console.log('DEBUG API Verify: Signature reçue:', signature); // Log

        // Compare signatures securely
        const receivedSigBuffer = Buffer.from(signature);
        const expectedSigBuffer = Buffer.from(expectedSignature);

        // Ensure buffers have the same length before comparing
        if (receivedSigBuffer.length !== expectedSigBuffer.length) {
             console.warn('DEBUG API Verify: ERREUR - Longueur de signature invalide.'); // Log length error
             return res.status(403).json({ error: "Signature invalide (longueur)." });
        }

        if (crypto.timingSafeEqual(receivedSigBuffer, expectedSigBuffer)) {
            // ✅ Signature is valid
            console.log("DEBUG API Verify: Signature VALIDE pour entry_id:", entry_id, "venant de:", origin); // Log success
            res.status(200).json({
                message: "Commande vérifiée",
                orderData: req.body // Send back the verified data
            });
        } else {
            // ❌ Signature is invalid
            console.warn("DEBUG API Verify: ERREUR - Signature INVALIDE (timingSafeEqual a échoué) pour entry_id:", entry_id); // Log failure
            return res.status(403).json({ error: "Signature invalide." });
        }
    } catch (error) {
        console.error('DEBUG API Verify: ERREUR lors de la vérification de la signature:', error); // Log comparison error
        return res.status(500).json({ error: "Erreur interne lors de la vérification." });
    }
});

// Endpoint to save payment details after Stripe confirmation
app.post('/api/save-payment-details', async (req, res) => {
    console.log('DEBUG API Save: Requête reçue à /api/save-payment-details'); // Log entry
    const dataFromClient = req.body; // Contains email, stripePaymentMethodId, entry_id, total, produit, origin, etc.

    try {
        // Basic validation
        if (!dataFromClient.stripePaymentMethodId || !dataFromClient.email || !dataFromClient.entry_id) {
             console.warn('DEBUG API Save: Données essentielles manquantes:', dataFromClient); // Log missing essential data
            throw new Error('Données essentielles manquantes pour la sauvegarde.'); // Throw error to trigger error email
        }

        // Add server-side info
        dataFromClient.ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        dataFromClient.systemInfo = req.headers['user-agent'];
        console.log('DEBUG API Save: Données à sauvegarder:', dataFromClient); // Log data before saving

        // Save to MongoDB
        const newUserPayment = new UserPayment(dataFromClient);
        await newUserPayment.save();
        console.log(`DEBUG API Save: Détails sauvegardés avec succès pour entry_id: ${dataFromClient.entry_id}`); // Log success save

        // === 🚀 Send SUCCESS Email ===
        await sendSuccessEmail(dataFromClient);
        // ============================

        res.status(201).json({
            message: 'Détails sauvegardés avec succès',
            // data: newUserPayment // Optionally send back saved data
        });

    } catch (error) {
        console.error(`DEBUG API Save: ERREUR lors de la sauvegarde pour ${dataFromClient.email || 'email inconnu'}:`, error); // Log the error

        // === 🚀 Send ERROR Email ===
        await sendErrorEmail(error, dataFromClient);
        // ==========================

        res.status(500).json({ error: 'Erreur interne du serveur lors de la sauvegarde.' });
    }
});

// --- 9. Start Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend server khddam 3la port ${PORT}`);
});