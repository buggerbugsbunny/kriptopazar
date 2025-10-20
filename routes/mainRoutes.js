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

// ****** YENİ EKLENDİ (Kalıcı Veritabanı Önbelleği) ******
const PriceCache = require('../models/PriceCache'); // Modeli import et

// Fiyatları 2 SAAT (120 dakika) boyunca veritabanı önbelleğinde tut (GÜNCELLENDİ)
const DB_CACHE_DURATION_MS = 120 * 60 * 1000; 

// Fiyatları getiren/önbellekten çeken YENİ yardımcı fonksiyon
async function getFreshPrices() {
    const now = Date.now();
    const cacheId = 'all_prices'; // Her zaman bu dökümanı arayacağız

    try {
        // 1. Önbelleği veritabanından kontrol et
        const cache = await PriceCache.findById(cacheId);

        // 2. Önbellek varsa VE 2 saatten yeniyse, veritabanından dön
        if (cache && (now - new Date(cache.updatedAt).getTime() < DB_CACHE_DURATION_MS)) {
            console.log("... Fiyatlar (getFreshPrices) Veritabanı Önbelleğinden alındı.");
            return cache.rates; // Kayıtlı 'rates' objesini döndür
        }

        // 3. Önbellek yoksa VEYA 2 saatten eskiyse, CoinGecko'dan çek
        console.log("... Fiyatlar (getFreshPrices) CoinGecko'dan çekiliyor (Veritabanı güncellenecek).");
        
        const cryptos = await Crypto.find().lean();
        if (!cryptos || cryptos.length === 0) {
             console.log("... Çekilecek kripto (Crypto) bulunamadı. Boş dönülüyor.");
             return {}; // Çekilecek kripto yoksa boş dön
        }
        
        const apiIds = cryptos.map(c => c.api_id).join(',');
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${apiIds}&vs_currencies=try`);
        
        const newRates = response.data;

        // 4. Yeni fiyatları veritabanına kaydet (veya güncelle)
        await PriceCache.findByIdAndUpdate(
            cacheId, 
            { rates: newRates }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        
        console.log("... Veritabanı önbelleği güncellendi.");
        return newRates;

    } catch (err) {
        console.error("!!! Fiyat çekme (getFreshPrices) hatası:", err.message);
        // Hata durumunda, eski önbellek varsa onu kullanarak sitenin çökmesini engelle
        const cache = await PriceCache.findById(cacheId);
        if (cache && cache.rates) {
            console.warn("   -> Fiyat çekilemedi, eski (stale) veritabanı önbelleği sunuluyor.");
            return cache.rates; 
        }
        // Hiçbir şey yoksa boş obje döndür
        return {};
    }
}
// ****** /GÜNCELLENEN BÖLÜM SONU ******


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

// (Bu rota artık veritabanı önbellekli 'getFreshPrices' fonksiyonunu kullanıyor)
router.get('/api/prices', verifyToken, async (req, res) => {
    try {
        // 1. Önbellekli yardımcı fonksiyondan ham 'rates' (api_id bazlı) verisini al
        const rates = await getFreshPrices(); 

        // 2. 'rates' verisini 'symbol' bazlı 'priceMap'e dönüştür (shop.ejs'nin beklediği format)
        const cryptos = await Crypto.find().lean(); 
        const priceMap = {};
        
        cryptos.forEach(crypto => {
            if (rates[crypto.api_id] && rates[crypto.api_id].try) {
                priceMap[crypto.symbol] = rates[crypto.api_id].try;
            }
        });
        
        res.json(priceMap);
    } catch (err) { 
        console.error("!!! /api/prices HATASI:", err.message); 
        res.status(500).json({ error: 'Fiyatlar alınamadı.' }); 
    }
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

// (Bu rota artık veritabanı önbellekli 'getFreshPrices' fonksiyonunu kullanıyor)
router.post('/checkout', verifyToken, async (req, res) => {
    console.log("--- POST /checkout isteği alındı:", req.body);
    try {
        const { productId, quantity, note, selectedCryptoId, transactionId } = req.body;
        const numQuantity = parseInt(quantity);
        
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
        
        const selectedCrypto = product.availableCryptos.find(crypto => crypto._id.toString() === selectedCryptoId);
        if (!selectedCrypto) { 
            return res.status(400).json({ success: false, message: 'Bu ödeme yöntemi bu ürün için geçerli değil.' }); 
        }

        // --- GÜVENLİK İYİLEŞTİRMESİ: Sunucu Tarafında Fiyat Hesaplama (Önbellekli) ---
        let calculatedPaymentInfo;
        try {
            // YENİ: Önbellekli yardımcı fonksiyondan ham 'rates' (api_id bazlı) verisini al
            const allRates = await getFreshPrices();
            
            if (!allRates[selectedCrypto.api_id] || !allRates[selectedCrypto.api_id].try) {
                 throw new Error(`Anlık kur bilgisi (Veritabanı Önbellek) alınamadı (${selectedCrypto.api_id}).`);
            }
            const rate = allRates[selectedCrypto.api_id].try;
            
            if (!rate || rate <= 0) {
                throw new Error('Anlık kur bilgisi alınamadı.');
            }
            const totalCryptoAmount = (product.price_tl * numQuantity) / rate;
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
            paymentInfo: calculatedPaymentInfo,
            messages: initialMessages,
            status: 'Beklemede',
            isArchived: false,
            hasUnreadUserMessage: initialMessages.length > 0,
            transactionId: transactionId.trim()
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
        
        // (Diğer isteğinizden gelen 15dk mesaj filtresi)
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        if (order.messages && Array.isArray(order.messages)) {
            order.messages = order.messages.filter(msg => {
                return new Date(msg.timestamp) > fifteenMinutesAgo;
            });
        }
        
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
