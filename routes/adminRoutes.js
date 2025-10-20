// routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Gerekli tüm modelleri import ediyoruz
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const Crypto = require('../models/Crypto');
const City = require('../models/City');
const Order = require('../models/Order');

// --- GİZLİ YOL DEĞİŞKENLERİ ---
const ADMIN_PREFIX = '/s-panel-a4x9';
const ADMIN_LOGIN_PATH = '/gizli-erisim-b7k2';
const FULL_LOGIN_URL = ADMIN_PREFIX + ADMIN_LOGIN_PATH;

// --- Hata Mesajı Temizleme Yardımcı Fonksiyonu ---
const cleanErrorMessage = (message) => {
    if (typeof message !== 'string') return 'Bilinmeyen Sunucu Hatası';
    return message.replace(/cite_start\s+is\s+not\s+defined/gi, 'Geçersiz Veri');
};


// --- Admin Giriş Kontrol Middleware (Yönlendirme doğru) ---
const isAuth = (req, res, next) => {
    console.log(`--- isAuth Kontrolü Tetiklendi: ${req.path} ---`);
    if (req.session && req.session.isAdmin) {
        console.log("   Durum: Yetkili (isAdmin=true). İzin verildi.");
        next();
    } else {
        console.warn("   Durum: Yetkisiz. Gizli giriş sayfasına yönlendiriliyor.");
        req.flash('error', 'Bu sayfaya erişim için giriş yapmalısınız.');
        res.redirect(FULL_LOGIN_URL);
    }
};

// --- GET Rotaları (Sayfa Gösterimleri) ---

// GET /gizli-erisim-b7k2 (Doğru)
router.get(ADMIN_LOGIN_PATH, (req, res) => {
    console.log(`--- GET ${ADMIN_LOGIN_PATH} isteği alındı (Giriş sayfası gösteriliyor) ---`);
    res.render('adminLogin');
});

// GET /logout (Yönlendirme doğru)
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.log("Çıkış yaparken session hatası:", err);
        }
        console.log('--- Admin oturumu sonlandırıldı (logout) ---');
        res.redirect(FULL_LOGIN_URL);
    });
});

// GET /dashboard (Yönlendirme doğru)
router.get('/dashboard', isAuth, async (req, res, next) => {
    console.log("--- GET /dashboard isteği alındı (Dashboard yükleniyor) ---");
    try {
        console.log("   Veritabanından veriler çekiliyor...");
        const orders = await Order.find()
            .sort({ hasUnreadUserMessage: -1, createdAt: -1 })
            .lean();
        const shops = await Shop.find().populate('city').lean();
        const products = await Product.find().populate('shop').lean(); 
        const cryptos = await Crypto.find().lean();
        const cities = await City.find().lean();
        
        console.log("   Veriler çekildi. Dashboard render ediliyor.");
        
        // Flash mesaj okumaları app.js'de yapıldığı için buradan kaldırıldı.
        // res.locals üzerinden EJS'ye otomatik gidiyor.
        const successMsg = req.flash('success'); // (Dashboard'a yönlendirmede flash gerekebilir)
        const errorMsg = req.flash('error');

        res.render('dashboard', {
            orders,
            shops,
            products,
            cryptos,
            cities,
            successMsg,
            errorMsg
        });
    } catch (err) {
        console.error('!!! HATA: Dashboard yükleme hatası:', err);
        req.flash('error', 'Dashboard yüklenirken bir hata oluştu: ' + err.message);
        res.redirect(FULL_LOGIN_URL); // Hata olursa login'e yolla
    }
});

// ****** GÜNCELLENDİ (Tüm /dashboard yönlendirmeleri) ******

// GET /edit-shop/:id - Dükkan düzenleme sayfasını göster
router.get('/edit-shop/:id', isAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)){
             req.flash('error', 'Geçersiz Dükkan ID.');
             return res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
        }
        const [shop, cities] = await Promise.all([
            Shop.findById(req.params.id).populate('city').lean(),
            City.find().sort({ name: 1 }).lean()
        ]);
        if (!shop) {
            req.flash('error', 'Dükkan bulunamadı.');
            return res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
        }
        res.render('edit-shop', { shop, cities });
    } catch (err) {
        req.flash('error', 'Dükkan düzenleme sayfası yüklenemedi: ' + err.message);
        res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
    }
});


// GET /edit-product/:id - Ürün düzenleme sayfasını göster
router.get('/edit-product/:id', isAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error', 'Geçersiz Ürün ID.');
            return res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
        }

        const [product, shops, allCryptos] = await Promise.all([
            Product.findById(req.params.id).lean(),
            Shop.find().populate('city').lean(),
            Crypto.find().lean()
        ]);

        if (!product) {
            req.flash('error', 'Ürün bulunamadı.');
            return res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
        }

        res.render('edit-product', {
            product: product,
            shops: shops,
            allCryptos: allCryptos
        });
    } catch (err) {
        console.error("GET /edit-product hatası:", err);
        req.flash('error', 'Ürün düzenleme sayfası yüklenemedi: ' + err.message);
        res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
    }
});

// GET /edit-crypto/:id - Kripto cüzdanı düzenleme sayfasını göster
router.get('/edit-crypto/:id', isAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error', 'Geçersiz Kripto ID.');
            return res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
        }
        const crypto = await Crypto.findById(req.params.id).lean();
        if (!crypto) {
            req.flash('error', 'Kripto cüzdanı bulunamadı.');
            return res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
        }
        res.render('edit-crypto', { crypto: crypto });
    } catch (err) {
        req.flash('error', 'Kripto cüzdanı düzenleme sayfası yüklenemedi: ' + err.message);
        res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
    }
});


// --- POST Rotaları (Form İşlemleri) ---

// POST /gizli-erisim-b7k2 (Yönlendirme DÜZELTİLDİ)
router.post(ADMIN_LOGIN_PATH, async (req, res) => {
    console.log(`--- POST ${ADMIN_LOGIN_PATH} isteği alındı (Giriş denemesi) ---`);
    try {
        const { password } = req.body;

        if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.trim() === '') {
            console.error("!!! GÜVENLİK HATASI: .env dosyasında ADMIN_PASSWORD ayarlanmamış veya boş!");
            req.flash('error', 'Sunucu yapılandırma hatası.');
            return res.redirect(FULL_LOGIN_URL);
        }

        if (password && password === process.env.ADMIN_PASSWORD) {
            console.log("   Durum: Şifre DOĞRU.");
            req.session.isAdmin = true;
            
            req.session.save(err => {
                if (err) { 
                    console.error("   !!! HATA: Session kaydetme hatası:", err); 
                    req.flash('error', 'Oturum hatası oluştu.'); 
                    return res.redirect(FULL_LOGIN_URL); 
                }
                console.log("   Durum: Session kaydedildi. /dashboard yönlendiriliyor...");
                // ****** GÜNCELLENDİ ******
                // '/dashboard' (root) yerine tam prefix'li yola yönlendir
                res.redirect(`${ADMIN_PREFIX}/dashboard`);
                // ****** /GÜNCELLENDİ ******
            });
        } else {
            console.warn("   Durum: Şifre YANLIŞ.");
            req.flash('error', 'Yanlış şifre.');
            res.redirect(FULL_LOGIN_URL);
        }
    } catch (err) { 
        console.error("   !!! HATA: Admin login try-catch bloğuna düştü:", err); 
        req.flash('error', 'Giriş sırasında bir sunucu hatası oluştu.'); 
        res.redirect(FULL_LOGIN_URL); 
    }
});

// -------------------------------------------------------------------
// *** POST CRUD ROTALARI (Tüm yönlendirmeler düzeltildi) ***
// -------------------------------------------------------------------

// --- Şehir İşlemleri ---
router.post('/add-city', isAuth, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || name.trim() === '') throw new Error('Şehir adı boş olamaz.');
        const newCity = new City({ name: name.trim() });
        await newCity.save();
        req.flash('success', `Şehir "${newCity.name}" başarıyla eklendi.`);
    } catch (err) {
        const errorMessage = err.code === 11000 ? 'Bu şehir zaten mevcut.' : cleanErrorMessage(err.message);
        req.flash('error', 'Şehir eklenemedi: ' + errorMessage);
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/delete-city/:id', isAuth, async (req, res) => {
    try {
        const cityId = req.params.id; 
        if (!mongoose.Types.ObjectId.isValid(cityId)) throw new Error('Geçersiz Şehir ID.');

        const shopCount = await Shop.countDocuments({ city: cityId });
        if (shopCount > 0) {
            throw new Error(`Bu şehirde ${shopCount} dükkan kayıtlı. Lütfen önce dükkanları silin veya taşıyın.`);
        }

        const deletedCity = await City.findByIdAndDelete(cityId);
        if (!deletedCity) throw new Error('Silinecek şehir bulunamadı.');
        req.flash('success', `Şehir "${deletedCity.name}" başarıyla silindi.`);
    } catch (err) {
        req.flash('error', 'Şehir silinemedi: ' + cleanErrorMessage(err.message));
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});


// --- Dükkan İşlemleri ---
router.post('/add-shop', isAuth, async (req, res) => {
    try {
        const { name, description, city, imageUrl } = req.body;
        if (!name || name.trim() === '') throw new Error('Dükkan adı boş olamaz.');
        if (!mongoose.Types.ObjectId.isValid(city)) throw new Error('Geçersiz Şehir ID.');

        const newShop = new Shop({
            name: name.trim(),
            description: description ? description.trim() : '',
            city: city,
            imageUrl: imageUrl || ''
        });
        await newShop.save();
        req.flash('success', `Dükkan "${newShop.name}" başarıyla eklendi.`);
    } catch (err) {
        req.flash('error', 'Dükkan eklenemedi: ' + cleanErrorMessage(err.message));
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/delete-shop/:id', isAuth, async (req, res) => {
    try {
        const shopId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(shopId)) throw new Error('Geçersiz Dükkan ID.');

        const productCount = await Product.countDocuments({ shop: shopId });
        if (productCount > 0) {
            throw new Error(`Bu dükkana bağlı ${productCount} ürün var. Lütfen önce ürünleri silin.`);
        }

        const deletedShop = await Shop.findByIdAndDelete(shopId);
        if (!deletedShop) throw new Error('Silinecek dükkan bulunamadı.');
        req.flash('success', `Dükkan "${deletedShop.name}" başarıyla silindi.`);
    } catch (err) {
        req.flash('error', 'Dükkan silinemedi: ' + cleanErrorMessage(err.message));
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/edit-shop/:id', isAuth, async (req, res) => {
    try {
        const shopId = req.params.id;
        const { name, description, city, imageUrl } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(shopId)) throw new Error('Geçersiz Dükkan ID.');
        if (!mongoose.Types.ObjectId.isValid(city)) throw new Error('Geçersiz Şehir ID.');
        if (!name || name.trim() === '') throw new Error('Dükkan adı boş olamaz.');

        const updatedShop = await Shop.findByIdAndUpdate(shopId, {
            name: name.trim(),
            description: description ? description.trim() : '',
            city: city,
            imageUrl: imageUrl || ''
        }, { new: true, runValidators: true });

        if (!updatedShop) throw new Error('Güncellenecek dükkan bulunamadı.');

        req.flash('success', `Dükkan "${updatedShop.name}" başarıyla güncellendi.`);
        res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
    } catch (err) {
        req.flash('error', 'Dükkan güncellenemedi: ' + cleanErrorMessage(err.message));
        res.redirect(`${ADMIN_PREFIX}/edit-shop/${req.params.id}`); // GÜNCELLENDİ
    }
});


// --- Ürün İşlemleri ---
router.post('/add-product', isAuth, async (req, res) => {
    try {
        const { name, description, imageUrl, price_tl, inStock, shopId, availableCryptos } = req.body;
        
        if (!name || name.trim() === '') throw new Error('Ürün adı boş olamaz.');
        if (!mongoose.Types.ObjectId.isValid(shopId)) throw new Error('Geçersiz Dükkan ID.');
        const price = parseFloat(price_tl);
        if (isNaN(price) || price < 0) throw new Error('Geçerli bir fiyat girin.');

        const cryptoIds = Array.isArray(availableCryptos) ? availableCryptos : 
                          (availableCryptos ? [availableCryptos] : []);

        const newProduct = new Product({
            name: name.trim(),
            description: description ? description.trim() : '',
            imageUrl: imageUrl || '',
            price_tl: price,
            inStock: inStock === 'on',
            shop: shopId,
            availableCryptos: cryptoIds
        });
        await newProduct.save();
        req.flash('success', `Ürün "${newProduct.name}" başarıyla eklendi.`);
    } catch (err) {
        console.error("Ürün ekleme hatası:", err);
        req.flash('error', 'Ürün eklenemedi: ' + cleanErrorMessage(err.message));
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/delete-product/:id', isAuth, async (req, res) => {
    try {
        const productId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error('Geçersiz Ürün ID.');

        const deletedProduct = await Product.findByIdAndDelete(productId);
        if (!deletedProduct) throw new Error('Silinecek ürün bulunamadı.');

        req.flash('success', `Ürün "${deletedProduct.name}" başarıyla silindi.`);
    } catch (err) {
        req.flash('error', 'Ürün silinemedi: ' + cleanErrorMessage(err.message));
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});


router.post('/edit-product/:id', isAuth, async (req, res) => {
    try {
        const productId = req.params.id;
        const { name, description, imageUrl, price_tl, inStock, shopId, availableCryptos } = req.body;

        if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error('Geçersiz Ürün ID.');
        if (!name || name.trim() === '') throw new Error('Ürün adı boş olamaz.');
        if (!mongoose.Types.ObjectId.isValid(shopId)) throw new Error('Geçersiz Dükkan ID.');
        const price = parseFloat(price_tl);
        if (isNaN(price) || price < 0) throw new Error('Geçerli bir fiyat girin.');

        const cryptoIds = Array.isArray(availableCryptos) ? availableCryptos : 
                          (availableCryptos ? [availableCryptos] : []);
        
        const updatedProduct = await Product.findByIdAndUpdate(productId, {
            name: name.trim(),
            description: description ? description.trim() : '',
            imageUrl: imageUrl || '',
            price_tl: price,
            inStock: inStock === 'on',
            shop: shopId,
            availableCryptos: cryptoIds
        }, { new: true, runValidators: true });

        if (!updatedProduct) throw new Error('Güncellenecek ürün bulunamadı.');

        req.flash('success', `Ürün "${updatedProduct.name}" başarıyla güncellendi.`);
        res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
    } catch (err) {
        console.error("Ürün düzenleme hatası:", err);
        req.flash('error', 'Ürün güncellenemedi: ' + cleanErrorMessage(err.message));
        res.redirect(`${ADMIN_PREFIX}/edit-product/${req.params.id}`); // GÜNCELLENDİ
    }
});


// --- Kripto Cüzdan İşlemleri ---
router.post('/add-crypto', isAuth, async (req, res) => {
    try {
        const { walletName, symbol, api_id, walletAddress } = req.body;
        if (!walletName || !symbol || !api_id || !walletAddress) throw new Error('Tüm alanlar zorunludur.');

        const newCrypto = new Crypto({
            walletName: walletName.trim(),
            symbol: symbol.trim().toUpperCase(),
            api_id: api_id.trim(),
            walletAddress: walletAddress.trim()
        });
        await newCrypto.save();
        req.flash('success', `Kripto Cüzdanı "${newCrypto.walletName} (${newCrypto.symbol})" başarıyla eklendi.`);
    } catch (err) {
        const errorMessage = err.code === 11000 ? 'Bu cüzdan adı zaten mevcut.' : cleanErrorMessage(err.message);
        req.flash('error', 'Kripto Cüzdanı eklenemedi: ' + errorMessage);
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/delete-crypto/:id', isAuth, async (req, res) => {
    try {
        const cryptoId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(cryptoId)) throw new Error('Geçersiz Kripto ID.');

        const productCount = await Product.countDocuments({ availableCryptos: cryptoId });
        if (productCount > 0) {
             throw new Error(`Bu cüzdan ${productCount} üründe ödeme yöntemi olarak kullanılıyor. Lütfen önce ürünleri güncelleyin.`);
        }

        const deletedCrypto = await Crypto.findByIdAndDelete(cryptoId);
        if (!deletedCrypto) throw new Error('Silinecek kripto cüzdanı bulunamadı.');
        
        req.flash('success', `Kripto Cüzdanı "${deletedCrypto.walletName} (${deletedCrypto.symbol})" silindi.`);
    } catch (err) {
        req.flash('error', 'Kripto Cüzdanı silinemedi: ' + cleanErrorMessage(err.message));
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/edit-crypto/:id', isAuth, async (req, res) => {
    try {
        const cryptoId = req.params.id;
        const { walletName, symbol, api_id, walletAddress } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(cryptoId)) throw new Error('Geçersiz Kripto ID.');
        if (!walletName || !symbol || !api_id || !walletAddress) throw new Error('Tüm alanlar zorunludur.');

        const updatedCrypto = await Crypto.findByIdAndUpdate(cryptoId, {
            walletName: walletName.trim(),
            symbol: symbol.trim().toUpperCase(),
            api_id: api_id.trim(),
            walletAddress: walletAddress.trim()
        }, { new: true, runValidators: true });

        if (!updatedCrypto) throw new Error('Güncellenecek kripto cüzdanı bulunamadı.');

        req.flash('success', `Kripto Cüzdanı "${updatedCrypto.walletName} (${updatedCrypto.symbol})" başarıyla güncellendi.`);
        res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
    } catch (err) {
        const errorMessage = err.code === 11000 ? 'Bu cüzdan adı zaten mevcut.' : cleanErrorMessage(err.message);
        req.flash('error', 'Kripto Cüzdanı güncellenemedi: ' + errorMessage);
        res.redirect(`${ADMIN_PREFIX}/edit-crypto/${req.params.id}`); // GÜNCELLENDİ
    }
});

// -------------------------------------------------------------------
// *** SİPARİŞ YÖNETİMİ ***
// -------------------------------------------------------------------

router.post('/update-order-status', isAuth, async (req, res) => {
    try {
        const { orderId, newStatus } = req.body;
        if (!mongoose.Types.ObjectId.isValid(orderId)) throw new Error('Geçersiz Sipariş ID.');
        const validStatuses = ['Beklemede', 'Tamamlandı', 'İptal'];
        if (!validStatuses.includes(newStatus)) throw new Error('Geçersiz durum bilgisi.');

        const updatedOrder = await Order.findByIdAndUpdate(orderId, { status: newStatus }, { new: true });
        if (!updatedOrder) throw new Error('Güncellenecek sipariş bulunamadı.');
        
        let displayStatus = newStatus;
        if (newStatus === 'Tamamlandı') displayStatus = 'Ödeme Onaylandı';
        else if (newStatus === 'İptal') displayStatus = 'İptal Edildi';

        req.flash('success', `Sipariş #${updatedOrder.orderNumber} durumu "${displayStatus}" olarak güncellendi.`);
    } catch (err) { 
        req.flash('error', 'Durum güncellenemedi: ' + cleanErrorMessage(err.message)); 
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/send-message', isAuth, async (req, res) => {
    console.log(`--- Admin Mesaj Gönderme İsteği ---`);
    try {
        const { orderId, adminReply } = req.body;
        if (!orderId || !adminReply || adminReply.trim() === '') throw new Error('Eksik bilgi veya boş mesaj.');
        
        if (!mongoose.Types.ObjectId.isValid(orderId)) throw new Error('Geçersiz Sipariş ID.');

        const message = { sender: 'admin', text: adminReply.trim(), timestamp: new Date() };
        
        const updatedOrder = await Order.findByIdAndUpdate(orderId, 
            { 
                $push: { messages: message },
                $set: { hasUnreadUserMessage: false }
            }, 
            { new: true }
        );

        if (!updatedOrder) { throw new Error('Mesaj gönderilecek sipariş bulunamadı.'); }

        req.flash('success', `Sipariş #${updatedOrder.orderNumber} için mesaj gönderildi.`);
    } catch (err) { 
        console.error('*** ADMIN MESAJ GÖNDERME HATASI BAŞLANGIÇ ***');
        console.error('err.message içeriği:', err.message);
        console.error(err);
        console.error('*** ADMIN MESAJ GÖNDERME HATASI SONU ***');
        
        req.flash('error', 'Mesaj gönderilemedi: ' + cleanErrorMessage(err.message)); 
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/archive-order/:id', isAuth, async (req, res) => {
    try {
        const orderId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(orderId)) throw new Error('Geçersiz Sipariş ID.');

        const updatedOrder = await Order.findByIdAndUpdate(orderId,
            { $set: { isArchived: true } }, 
            { new: true }
        );

        if (!updatedOrder) throw new Error('Arşivlenecek sipariş bulunamadı.');
        req.flash('success', `Sipariş #${updatedOrder.orderNumber} arşivlendi.`);
    } catch (err) {
        console.error("Arşivleme hatası:", err);
        req.flash('error', 'Sipariş arşivlenemedi: ' + cleanErrorMessage(err.message));
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

router.post('/delete-archived-order/:id', isAuth, async (req, res) => {
    try {
        const orderId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(orderId)) throw new Error('Geçersiz Sipariş ID.');

        const deletedOrder = await Order.findOneAndDelete({ _id: orderId, isArchived: true });

        if (!deletedOrder) throw new Error('Silinecek arşivlenmiş sipariş bulunamadı veya sipariş arşivlenmemiş.');
        req.flash('success', `Arşivlenmiş Sipariş #${deletedOrder.orderNumber} kalıcı olarak silindi.`);
    } catch (err) {
        console.error("Arşivlenmiş sipariş silme hatası:", err);
        req.flash('error', 'Arşivlenmiş sipariş silinemedi: ' + cleanErrorMessage(err.message));
    }
    res.redirect(`${ADMIN_PREFIX}/dashboard`); // GÜNCELLENDİ
});

// Router'ı export et
module.exports = router;