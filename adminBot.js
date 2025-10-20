// adminBot.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const Order = require('./models/Order'); // Order modelini import et

const ADMIN_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
// ****** YENİ EKLENDİ ******
const SITE_URL = process.env.SITE_URL; 
// ****** /YENİ EKLENDİ ******

let replyIntent = {};

// ****** GÜNCELLENDİ (SITE_URL kontrolü eklendi) ******
if (!ADMIN_TOKEN || !ADMIN_CHAT_ID || !SITE_URL) {
    console.error("Lütfen .env dosyasındaki ADMIN_BOT_TOKEN, ADMIN_CHAT_ID ve SITE_URL değişkenlerini ayarlayın!");
}
// ****** /GÜNCELLENDİ ******

let bot;
if (ADMIN_TOKEN && ADMIN_CHAT_ID) {
    try {
        bot = new TelegramBot(ADMIN_TOKEN, { polling: true });
        console.log("Yönetici Telegram Botu çalışmaya başladı...");
    } catch (error) {
        console.error("Yönetici botu başlatılırken hata:", error.message);
        bot = null;
    }
} else {
    console.warn("Yönetici botu için ADMIN_TOKEN, ADMIN_CHAT_ID veya SITE_URL eksik, bot başlatılamadı.");
    bot = null;
}

// --- YARDIMCI FONKSİYONLAR ---
const formatMessages = (messages) => {
     if (!messages || messages.length === 0) { return "<i>Bu sipariş için henüz mesaj yok.</i>"; }
    return messages.map(msg => {
        const sender = msg.sender === 'admin' ? '<b>Siz</b>' : '<b>Kullanıcı</b>';
        const date = new Date(msg.timestamp || Date.now()).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year:'numeric', hour: '2-digit', minute: '2-digit' });
        const text = msg.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `${sender} (${date}):\n${text}`;
    }).join('\n--------------------\n');
};

const formatDate = (date) => {
    if (!date) return '?';
    return new Date(date).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year:'numeric', hour: '2-digit', minute: '2-digit' });
};

// (Bu fonksiyonlar sizde mevcut, değişikliğe gerek yok)
const updateOrderStatus = async (chatId, orderNumber, newStatus) => { 
    if (chatId.toString() !== ADMIN_CHAT_ID) return;
    try {
        const order = await Order.findOneAndUpdate(
            { orderNumber: orderNumber },
            { $set: { status: newStatus } },
            { new: true }
        );
        if (!order) return bot.sendMessage(chatId, `\`${orderNumber}\` bulunamadı.`);
        bot.sendMessage(chatId, `✅ Sipariş \`${orderNumber}\` durumu *${newStatus}* olarak güncellendi.`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error(`Durum güncellenirken hata (${orderNumber}):`, error);
        bot.sendMessage(chatId, `Hata: ${error.message}`);
    }
};
const updateOrderArchiveStatus = async (chatId, orderNumber, isArchived) => { 
    if (chatId.toString() !== ADMIN_CHAT_ID) return;
     try {
        const order = await Order.findOneAndUpdate(
            { orderNumber: orderNumber },
            { $set: { isArchived: isArchived } },
            { new: true }
        );
        if (!order) return bot.sendMessage(chatId, `\`${orderNumber}\` bulunamadı.`);
        const statusText = isArchived ? "Arşivlendi" : "Arşivden Çıkarıldı";
        bot.sendMessage(chatId, `✅ Sipariş \`${orderNumber}\` *${statusText}*.`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error(`Arşiv durumu güncellenirken hata (${orderNumber}):`, error);
        bot.sendMessage(chatId, `Hata: ${error.message}`);
    }
};


// --- DIŞARIYA AÇILACAK BİLDİRİM FONKSİYONLARI ---

// Yeni Sipariş Bildirimi (TxID Eklendi)
const sendNewOrderNotification = (order) => {
    if (!bot || !ADMIN_CHAT_ID) return;
    try {
        const message = `📦 *Yeni Sipariş Alındı!*\n\n` +
                        `*Sipariş No:* \`${order.orderNumber}\`\n` +
                        `*Ürün:* ${order.productName} (x${order.quantity})\n` +
                        `*Ödeme:* ${order.paymentInfo}\n` +
                        (order.transactionId ? `*TxID:* \`${order.transactionId}\`\n` : '') +
                        (order.messages && order.messages.length > 0 ? `*Not:* ${order.messages[0].text}\n` : '') +
                        `\n_İşlem yapmak için aşağıdaki butonları kullanın._`;
        
        const options = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Onayla (Tamamlandı)', callback_data: `confirm:${order.orderNumber}` },
                        { text: 'Reddet (İptal)', callback_data: `cancel:${order.orderNumber}` }
                    ],
                    [
                        { text: 'Detayları Gör', callback_data: `view:${order.orderNumber}` },
                        { text: 'Yanıtla', callback_data: `reply_init:${order.orderNumber}` },
                        { text: 'Arşivle', callback_data: `archive:${order.orderNumber}` }
                    ]
                ]
            }
        };

        bot.sendMessage(ADMIN_CHAT_ID, message, options)
           .catch(err => console.error("Admin'e yeni sipariş bildirimi gönderilemedi:", err.message));
    } catch (error) { console.error("Yeni sipariş bildirimi oluşturulurken hata:", error); }
};

// Yeni Kullanıcı Mesajı Bildirimi
const sendNewUserMessageNotification = (order, userMessageText) => {
    if (!bot || !ADMIN_CHAT_ID) return;
     try {
        const message = `💬 *Yeni Mesaj!* (\`${order.orderNumber}\`)\n\n` +
                        `*Kullanıcı:* ${userMessageText}\n` +
                        `\n_İşlem yapmak için aşağıdaki butonları kullanın._`;
        
        const options = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Detayları Gör', callback_data: `view:${order.orderNumber}` },
                        { text: 'Yanıtla', callback_data: `reply_init:${order.orderNumber}` }
                    ]
                ]
            }
        };

        bot.sendMessage(ADMIN_CHAT_ID, message, options)
           .catch(err => console.error("Admin'e yeni mesaj bildirimi gönderilemedi:", err.message));
    } catch (error) { console.error("Yeni mesaj bildirimi oluşturulurken hata:", error); }
};


// Sadece bot başarılı bir şekilde başlatıldıysa olay dinleyicilerini ekle
if (bot) {
    // --- CALLBACK QUERY HANDLER (BUTON TIKLAMALARI) ---
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;

        if (chatId.toString() !== ADMIN_CHAT_ID) { bot.answerCallbackQuery(callbackQuery.id); return; }
        const [action, orderNumber] = data.split(':');
        if (!orderNumber) { bot.answerCallbackQuery(callbackQuery.id, 'Hata: Sipariş No bulunamadı.'); return; }
        bot.answerCallbackQuery(callbackQuery.id); // Tıklamayı onayla

        switch (action) {
            case 'confirm': await updateOrderStatus(chatId, orderNumber, 'Tamamlandı'); break;
            case 'cancel': await updateOrderStatus(chatId, orderNumber, 'İptal'); break;
            case 'archive': await updateOrderArchiveStatus(chatId, orderNumber, true); break;
            case 'view':
                try {
                    const order = await Order.findOne({ orderNumber: orderNumber });
                    if (!order) { return bot.sendMessage(chatId, `\`${orderNumber}\` numaralı sipariş bulunamadı.`); }
                    const formattedMessages = formatMessages(order.messages);
                    const response = `<b>Sipariş No:</b> <code>${order.orderNumber}</code>\n` +
                                     `<b>Oluşturulma:</b> ${formatDate(order.createdAt)}\n` +
                                     `<b>Ürün:</b> ${order.productName}\n` +
                                     `<b>Durum:</b> ${order.status}\n` +
                                     `<b>Arşivde:</b> ${order.isArchived ? 'Evet' : 'Hayır'}\n` +
                                     (order.transactionId ? `<b>TxID:</b> <code>${order.transactionId}</code>\n` : '') +
                                     `\n<b>Mesaj Geçmişi:</b>\n--------------------\n${formattedMessages}`;
                    bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
                } catch (error) { console.error(`Butonla view işlenirken hata (${orderNumber}):`, error); bot.sendMessage(chatId, `Sipariş detayları getirilirken bir hata oluştu: ${error.message}`); }
                break;
            case 'reply_init':
                replyIntent[chatId] = orderNumber;
                bot.sendMessage(chatId, `💬 \`${orderNumber}\` numaralı siparişe yanıt yazıyorsunuz.\nMesajınızı şimdi gönderin. İptal için /yanitiptal yazın.`);
                break;
            default: console.warn("Bilinmeyen callback query action:", action); bot.sendMessage(chatId, "Bilinmeyen bir işlem butonu tıklandı.");
        }
    });

    // --- BOT KOMUTLARI ---
    bot.onText(/^\/(baslat|yardim)$/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return;
        bot.sendMessage(chatId, 
            "📋 *Admin Bot Komutları*\n\n" +
            "*/admingiris* - Gizli admin paneli linkini alır.\n" +
            "*/bekleyenler* - Durumu 'Beklemede' olan siparişleri listeler.\n" +
            "*/okunmamislar* - Okunmamış kullanıcı mesajı olan siparişleri listeler.\n" +
            "*/son <adet>* - Son <adet> siparişi listeler (örn: /son 5).\n" +
            "*/ara <terim>* - Sipariş No, Ürün Adı veya TxID içinde arama yapar.\n" +
            "*/goruntule <EM-NO>* - Sipariş detaylarını gösterir (örn: /goruntule EM-123456).\n" +
            "*/onayla <EM-NO>* - Siparişi 'Tamamlandı' yapar.\n" +
            "*/iptal <EM-NO>* - Siparişi 'İptal' yapar.\n" +
            "*/arsivle <EM-NO>* - Siparişi arşivler.\n" +
            "*/arsivdenkaldir <EM-NO>* - Siparişi arşivden çıkarır.\n" +
            "*/arsivlisil <EM-NO>* - Arşivlenmiş bir siparişi kalıcı olarak siler.\n" +
            "*/yanitla <EM-NO> <mesaj>* - Siparişe hızlı mesaj gönderir.\n" +
            "*/mesajgonder <EM-NO> <mesaj>* - /yanitla ile aynı işi yapar.\n" +
            "*/yanitiptal* - Aktif yanıt yazma işlemini iptal eder.",
            { parse_mode: 'Markdown' }
        );
    });

    // ****** YENİ EKLENDİ (Admin Link Komutu) ******
    bot.onText(/^\/admingiris$/, (msg) => {
        const chatId = msg.chat.id;
        // Sadece yetkili adminin bu linki alabilmesini sağla
        if (chatId.toString() !== ADMIN_CHAT_ID) {
            console.warn(`Yetkisiz bir kullanıcı (/admingiris) denedi: ${chatId}`);
            return; 
        }
        try {
            // Gizli yolları buraya tam olarak yazın
            const link = `${SITE_URL}/s-panel-a4x9/gizli-erisim-b7k2`;
            bot.sendMessage(chatId, `🔐 Gizli admin paneli giriş linki:\n\`${link}\``, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error("/admingiris komutu işlenirken hata:", error);
            bot.sendMessage(chatId, "Link oluşturulurken bir hata oluştu.");
        }
    });
    // ****** /YENİ EKLENDİ ******

    // /goruntule
    bot.onText(/^\/goruntule (EM-[A-Z0-9]+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return;
        const orderNumber = match[1].toUpperCase();
        try {
            const order = await Order.findOne({ orderNumber: orderNumber });
            if (!order) return bot.sendMessage(chatId, `\`${orderNumber}\` bulunamadı.`);
            const formattedMessages = formatMessages(order.messages);
            const response = `<b>Sipariş No:</b> <code>${order.orderNumber}</code>\n<b>Oluşturulma:</b> ${formatDate(order.createdAt)}\n<b>Ürün:</b> ${order.productName}\n<b>Durum:</b> ${order.status}\n<b>Arşivde:</b> ${order.isArchived ? 'Evet' : 'Hayır'}\n` + (order.transactionId ? `<b>TxID:</b> <code>${order.transactionId}</code>\n` : '') + `\n<b>Mesaj Geçmişi:</b>\n--------------------\n${formattedMessages}`;
            bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
        } catch (error) { console.error(`/goruntule hata (${orderNumber}):`, error); bot.sendMessage(chatId, `Hata: ${error.message}`); }
    });

    bot.onText(/^\/onayla (EM-[A-Z0-9]+)$/i, async (msg, match) => {
        if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
        await updateOrderStatus(msg.chat.id, match[1].toUpperCase(), 'Tamamlandı');
    });

    bot.onText(/^\/iptal (EM-[A-Z0-9]+)$/i, async (msg, match) => {
        if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
        await updateOrderStatus(msg.chat.id, match[1].toUpperCase(), 'İptal');
    });

    bot.onText(/^\/arsivle (EM-[A-Z0-9]+)$/i, async (msg, match) => {
        if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
        await updateOrderArchiveStatus(msg.chat.id, match[1].toUpperCase(), true);
    });
    
    bot.onText(/^\/arsivdenkaldir (EM-[A-Z0-9]+)$/i, async (msg, match) => {
        if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
        await updateOrderArchiveStatus(msg.chat.id, match[1].toUpperCase(), false);
    });

    bot.onText(/^\/arsivlisil (EM-[A-Z0-9]+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return;
        const orderNumber = match[1].toUpperCase();
        try {
            const deletedOrder = await Order.findOneAndDelete({ orderNumber: orderNumber, isArchived: true });
            if (!deletedOrder) return bot.sendMessage(chatId, `Arşivlenmiş \`${orderNumber}\` siparişi bulunamadı veya silinemedi.`);
            bot.sendMessage(chatId, `🗑️ Arşivlenmiş sipariş \`${deletedOrder.orderNumber}\` kalıcı olarak silindi.`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error(`/arsivlisil hata (${orderNumber}):`, error);
            bot.sendMessage(chatId, `Hata: ${error.message}`);
        }
    });

    // Hızlı yanıt gönderme
    const sendAdminReply = async (chatId, orderNumber, text) => {
        if (chatId.toString() !== ADMIN_CHAT_ID) return;
        try {
            const message = { sender: 'admin', text: text.trim(), timestamp: new Date() };
            const updatedOrder = await Order.findOneAndUpdate(
                { orderNumber: orderNumber },
                { 
                    $push: { messages: message },
                    $set: { hasUnreadUserMessage: false } 
                },
                { new: true }
            );
            if (!updatedOrder) return bot.sendMessage(chatId, `\`${orderNumber}\` bulunamadı.`);
            bot.sendMessage(chatId, `✅ Mesajınız \`${orderNumber}\` nolu siparişe gönderildi.`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error(`Hızlı yanıt hatası (${orderNumber}):`, error);
            bot.sendMessage(chatId, `Hata: ${error.message}`);
        }
    };

    bot.onText(/^\/(yanitla|mesajgonder) (EM-[A-Z0-9]+) (.+)/s, async (msg, match) => {
        if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
        const orderNumber = match[2].toUpperCase();
        const text = match[3];
        await sendAdminReply(msg.chat.id, orderNumber, text);
    });

    bot.onText(/^\/yanitiptal$/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return;
        if (replyIntent[chatId]) {
            delete replyIntent[chatId];
            bot.sendMessage(chatId, "Yanıt işlemi iptal edildi.");
        } else {
            bot.sendMessage(chatId, "Aktif bir yanıt işlemi yok.");
        }
    });
    
    // Liste komutları
    const listOrders = async (chatId, query, sort, title, limit = 0) => {
        if (chatId.toString() !== ADMIN_CHAT_ID) return;
        try {
            let orders = await Order.find(query).sort(sort).limit(limit).lean();
            if (orders.length === 0) return bot.sendMessage(chatId, `_${title} kriterine uyan sipariş bulunamadı._`, { parse_mode: 'Markdown' });

            let response = `*${title} (${orders.length} adet)*\n\n`;
            response += orders.map(o => {
                let statusIcon = '⏳';
                if (o.status === 'Tamamlandı') statusIcon = '✅';
                else if (o.status === 'İptal') statusIcon = '❌';
                if (o.isArchived) statusIcon = '🗄️';
                
                let unread = o.hasUnreadUserMessage ? ' *[YENİ MESAJ]*' : '';
                
                return `*${statusIcon} \`${o.orderNumber}\`*${unread}\n_${o.productName}_`;
            }).join('\n\n');
            
            if (response.length > 4096) response = response.substring(0, 4090) + "... (çok uzun)";
            bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error(`Liste hatası (${title}):`, error);
            bot.sendMessage(chatId, `Hata: ${error.message}`);
        }
    };

    bot.onText(/^\/bekleyenler$/, async (msg) => {
        await listOrders(msg.chat.id, { status: 'Beklemede', isArchived: false }, { createdAt: -1 }, "Bekleyen Siparişler");
    });

    bot.onText(/^\/okunmamislar$/, async (msg) => {
        await listOrders(msg.chat.id, { hasUnreadUserMessage: true, isArchived: false }, { createdAt: -1 }, "Okunmamış Mesajı Olanlar");
    });
    
    bot.onText(/^\/son (\d+)$/, async (msg, match) => {
        const limit = parseInt(match[1]) || 5;
        await listOrders(msg.chat.id, {}, { createdAt: -1 }, `Son ${limit} Sipariş`, limit);
    });

    bot.onText(/^\/ara (.+)$/, async (msg, match) => {
        const term = match[1];
        const regex = new RegExp(term, 'i');
        const query = {
            $or: [
                { orderNumber: regex },
                { productName: regex },
                { transactionId: regex }
            ]
        };
        await listOrders(msg.chat.id, query, { createdAt: -1 }, `Arama Sonuçları: "${term}"`);
    });

    // Ana Mesaj Dinleyici (Yanıt için)
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return;

        // Komutları ve butonları tekrar tetiklemesin
        if (msg.text && msg.text.startsWith('/')) return;
        if (msg.reply_to_message) return;

        // Aktif bir yanıt yazma niyeti var mı?
        if (replyIntent[chatId]) {
            const orderNumber = replyIntent[chatId];
            const text = msg.text;
            delete replyIntent[chatId]; // Niyeti temizle
            await sendAdminReply(chatId, orderNumber, text);
        }
    });

    bot.on("polling_error", (error) => {
        console.error("Bot Polling Hatası (Yönetici):", error.code);
    });
} // if(bot) bloğunun sonu


// Bildirim fonksiyonlarını dışa aktar
module.exports = {
    sendNewOrderNotification,
    sendNewUserMessageNotification
};