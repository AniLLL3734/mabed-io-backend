const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const cors = require('cors');

// 1. Firebase Admin Setup (OyunMabedi Auth Doğrulaması İçin)
// DİKKAT: Render'a yüklediğinde Firebase Service Account JSON dosyanı ortam değişkeni (ENV) olarak eklemelisin.
// admin.initializeApp({
//   credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
// });

const app = express();
app.use(cors());
const server = http.createServer(app);

// Aktif oyuncu sayısı API'si (GameCard bileşeni bu endpoint'i çağırıyor)
app.get('/api/stats', (req, res) => {
    res.set('Cache-Control', 'public, max-age=10');
    res.json({ players: Object.keys(players).length });
});

// Socket.io Ayarları
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const WORLD_SIZE = 5000;
let players = {};
let foods = [];

// Yem Oluşturucu
for (let i = 0; i < 500; i++) {
    foods.push({
        id: i,
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        r: 5,
        c: ['#FF0055', '#00F2FF', '#7000FF', '#FFD700', '#00FF41'][Math.floor(Math.random() * 5)]
    });
}

// Yeni Oyuncu Bağlandığında
io.on('connection', async (socket) => {
    console.log('Birisi bağlanmaya çalışıyor:', socket.id);

    // 2. Token Doğrulama (Auth)
    socket.on('join_game', async (data) => {
        try {
            // const decodedToken = await admin.auth().verifyIdToken(data.token);
            // const userEmail = decodedToken.email;
            
            // Şimdilik test amaçlı tokensiz giriş (Firebase ayarlanana kadar):
            const playerName = data.name || "Anonim";
            
            players[socket.id] = {
                id: socket.id,
                name: playerName,
                cells: [{ x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE, r: 30 }],
                color: ['#FF0055', '#00F2FF', '#7000FF', '#FFD700', '#00FF41'][Math.floor(Math.random() * 5)]
            };

            // Oyuncuya dünyayı yolla
            socket.emit('init_data', { id: socket.id, foods: foods });
            
            console.log(playerName + ' oyuna katıldı.');
        } catch (error) {
            console.log('Giriş reddedildi. Geçersiz token.');
            socket.disconnect();
        }
    });

    // Oyuncu Hareket Ettiğinde (Senkronizasyon İçin İstemciye Güveniyoruz)
    socket.on('player_move', (cells) => {
        let p = players[socket.id];
        if(!p) return;
        
        // Direk istemciden gelen pozisyonları kaydet
        p.cells = cells;
    });

    // Oyuncu Çıktığında
    socket.on('disconnect', () => {
        if(players[socket.id]) {
            console.log(players[socket.id].name + ' ayrıldı.');
            delete players[socket.id];
        }
    });
});

// Sunucu Oyun Döngüsü (Saniyede 60 kez çarpışmaları kontrol et)
setInterval(() => {
    // Çarpışma Mantıkları (Yem yeme, oyuncu yeme vb.) burada hesaplanır.
    
    // Tüm oyunculara güncel durumu yolla
    io.emit('game_state', { players: players });
}, 1000 / 60);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log('Mabed.io Server çalışıyor. Port:', PORT);
});
