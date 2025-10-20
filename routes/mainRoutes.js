// routes/mainRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const Crypto = require('../models/Crypto');
const Order = require('../models/Order');
const adminBot = require('../adminBot');

const verifyToken = (req, res, next) => {
    const token = req.query.token;
    if (!token) { return res.redirect('/'); }
    const secret = process.env.JWT_SECRET;
    if (!secret) { console.error("JWT_SECRET eksik!"); return res.status(500).send("Sunucu hatası."); }
    jwt.verify(token, secret, (err, decoded) => {
        if (err) { console.log("Token hatası:", err.message); return res.redirect('/'); }
        req.user = decoded;
        next();
    });
};

router.get('/', (req, res) => { res.render('index'); });

router.get('/api/prices', verifyToken, async (req, res) => {
    try {
        const cryptos = await Crypto.find().lean();
        if (!cryptos || cryptos.length === 0) { return res.json({}); }
        const apiIds = cryptos.map(c => c.api_id).join(',');
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${apiIds}&vs_currencies=try`);
        const rates = response.data;
        const priceMap = {};
        cryptos.forEach(crypto => {
            if (rates[crypto.api_id] && rates[crypto.api_id].try) { priceMap[crypto.symbol] = rates[crypto.api_id].try; }
        });
        res.json(priceMap);
    } catch (err) { console.error("!!! /api/prices HATASI:", err.message); res.status(500).json({ error: 'Fiyatlar alınamadı.' }); }
});

router.get('/shop', verifyToken, async (req, res) => {
    try {
        const [allShops, allProducts, allCryptos] = await Promise.all([
            Shop.find().populate('city').lean(),
            Product.find().populate({ path: 'shop', populate: { path: 'city' }}).populate('availableCryptos').lean(),
            Crypto.find().lean()
        ]);
        const expirationTime = req.user.exp;
        const token = req.query.token;
        const availableSymbols = allCryptos.map(c => c.symbol);
        res.render('shop', { shops: allShops || [], products: allProducts || [], availableSymbols: availableSymbols || [], expirationTime, token });
    } catch (err) { console.error("Shop GET hatası:", err); res.status(500).send("Dükkan yüklenirken hata."); }
});

router.get('/checkout', verifyToken, async (req, res) => {
    const token = req.query.token;
    try {
        const { product_id } = req.query;
        if (!product_id || !mongoose.Types.ObjectId.isValid(product_id)) { throw new Error(`Geçersiz ürün ID.`); }
        const product = await Product.findById(product_id).populate('availableCryptos').lean();
        if (!product) { throw new Error("Ürün bulunamadı."); }
        const expirationTime = req.user.exp;
        res.render('checkout', { product: product, availableCryptos: product.availableCryptos || [], expirationTime, token, checkoutError: null });
    } catch (err) {
         console.error("!!! GET /checkout CATCH HATASI:", err);
         res.status(500).render('checkout', { product: null, availableCryptos: [], expirationTime: req.user?.exp || 0, token: token || '', checkoutError: `Beklenmedik hata: ${err.message}` });
    }
});

// ****** GÜNCELLENDİ (POST /checkout) ******
router.post('/checkout', verifyToken, async (req, res) => {
    console.log("--- POST /checkout isteği alındı:", req.body);
    try {
        // paymentInfo (riskli) kaldırıldı, transactionId (TxID) eklendi
        const { productId, quantity, note, selectedCryptoId, transactionId } = req.body;
        const numQuantity = parseInt(quantity);
        
        // TxID için katı regex kaldırıldı, sadece varlığı kontrol ediliyor.
        if (!productId || !mongoose.Types.ObjectId.isValid(productId) ||
            !numQuantity || numQuantity <= 0 ||
            !selectedCryptoId ||
            !transactionId || transactionId.trim() === '') { 
             console.warn("Geçersiz sipariş bilgisi veya boş TxID:", req.body);
             let errMsg = 'Geçersiz sipariş bilgisi. Tüm zorunlu alanlar doldurulmalıdır.';
             if (!transactionId || transactionId.trim() === '') { errMsg = 'Transaction ID (TxID) zorunludur.'; }
             return res.status(400).json({ success: false, message: errMsg });
        }

        const product = await Product.findById(productId).populate('availableCryptos');
        if (!product) { return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' }); }
        if (!product.inStock) { return res.status(400).json({ success: false, message: 'Bu ürün stokta yok.' }); }
        
        // Seçilen kripto paranın bu ürün için geçerli olup olmadığını kontrol et
        const selectedCrypto = product.availableCryptos.find(crypto => crypto._id.toString() === selectedCryptoId);
        if (!selectedCrypto) { 
            return res.status(400).json({ success: false, message: 'Bu ödeme yöntemi bu ürün için geçerli değil.' }); 
        }

        // --- GÜVENLİK İYİLEŞTİRMESİ: Sunucu Tarafında Fiyat Hesaplama ---
        let calculatedPaymentInfo;
        try {
            const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${selectedCrypto.api_id}&vs_currencies=try`);
            const rate = response.data[selectedCrypto.api_id].try;
            if (!rate || rate <= 0) {
                throw new Error('Anlık kur bilgisi alınamadı.');
            }
            const totalCryptoAmount = (product.price_tl * numQuantity) / rate;
            // Kripto miktarını 6 ondalık basamakla sınırla (checkout.ejs'deki gibi)
            calculatedPaymentInfo = `${totalCryptoAmount.toFixed(6)} ${selectedCrypto.symbol}`; 
        } catch (apiError) {
            console.error("!!! FİYAT HESAPLAMA HATASI (POST /checkout):", apiError.message);
            return res.status(500).json({ success: false, message: 'Ödeme tutarı hesaplanırken bir hata oluştu. Anlık kur alınamadı.' });
        }
        // --- /GÜVENLİK İYİLEŞTİRMESİ ---

        const initialMessages = [];
        if (note && note.trim() !== '') { initialMessages.push({ sender: 'user', text: note, timestamp: new Date() }); }

        let orderNumber;
        let isUnique = false;
        while (!isUnique) {
            orderNumber = 'EM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
            const existingOrder = await Order.findOne({ orderNumber: orderNumber });
            if (!existingOrder) { isUnique = true; }
        }

        const newOrder = new Order({
            orderNumber: orderNumber,
            productName: product.name,
            quantity: numQuantity,
            paymentInfo: calculatedPaymentInfo, // GÜVENLİ: Sunucuda hesaplanan fiyat kullanıldı
            messages: initialMessages,
            status: 'Beklemede',
            isArchived: false,
            hasUnreadUserMessage: initialMessages.length > 0,
            transactionId: transactionId.trim() // TxID kaydediliyor
        });
        const savedOrder = await newOrder.save();
        console.log("    Sipariş kaydedildi. No:", savedOrder.orderNumber);

        try { adminBot.sendNewOrderNotification(savedOrder); }
        catch (botError) { console.error("Admin'e yeni sipariş bildirimi gönderilirken hata oluştu (checkout):", botError); }

        res.json({ success: true, orderNumber: savedOrder.orderNumber });

    } catch (err) {
        console.error("!!! POST /checkout HATASI:", err);
        res.status(500).json({ success: false, message: err.message || 'Sunucu hatası.' });
    }
});

router.get('/api/track-order/:orderNumber', verifyToken, async (req, res) => {
    try {
        const { orderNumber } = req.params;
        if (!orderNumber || !orderNumber.startsWith('EM-')) { throw new Error('Geçersiz sipariş numarası formatı.'); }
        const order = await Order.findOne({ orderNumber: orderNumber.trim().toUpperCase() }).lean();
        if (!order) { return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' }); }
        res.json({ success: true, order: order });
    } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.post('/api/add-message', verifyToken, async (req, res) => {
     try {
        const { orderId, userMessage } = req.body;
        if (!orderId || !userMessage || userMessage.trim() === '') throw new Error('Eksik bilgi veya boş mesaj.');
        if (!mongoose.Types.ObjectId.isValid(orderId)) throw new Error('Geçersiz Sipariş ID.');
        const message = { sender: 'user', text: userMessage.trim(), timestamp: new Date() };
        const updatedOrder = await Order.findByIdAndUpdate(orderId, { $push: { messages: message }, $set: { hasUnreadUserMessage: true } }, { new: true }).lean();
        if (!updatedOrder) { return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' }); }
        try { adminBot.sendNewUserMessageNotification(updatedOrder, userMessage); }
        catch (botError) { console.error("Admin'e yeni mesaj bildirimi gönderilirken hata oluştu (add-message):", botError); }
        res.json({ success: true, messages: updatedOrder.messages });
    } catch (err) {
         console.error("!!! /api/add-message HATASI:", err);
         res.status(400).json({ success: false, message: `Mesaj gönderilemedi: ${err.message}` });
    }
});

module.exports = router;