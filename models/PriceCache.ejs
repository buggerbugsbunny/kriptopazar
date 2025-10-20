const mongoose = require('mongoose');

// Bu model, CoinGecko'dan gelen tüm fiyat verilerini
// tek bir dökümanda saklamak için kullanılacak.
const priceCacheSchema = new mongoose.Schema({
    // Benzersiz bir ID atayarak her zaman aynı dökümanı güncelleyeceğiz.
    _id: {
        type: String,
        default: 'all_prices' 
    },
    // Fiyatların ham JSON verisini burada saklayacağız
    rates: {
        type: Object,
        required: true
    }
}, {
    // 'updatedAt' alanını otomatik yönetir.
    // Fiyatların ne zaman güncellendiğini bilmemiz için bu şart.
    timestamps: true 
});

module.exports = mongoose.models.PriceCache || mongoose.model('PriceCache', priceCacheSchema);