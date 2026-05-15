const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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
const COLORS = ['#FF0055', '#00F2FF', '#7000FF', '#FFD700', '#00FF41'];
const MAX_FOOD = 600;
const FOOD_SPAWN_RATE = 10; // Her döngüde kontrol edilir, eksik yem tamamlanır

let players = {};
let foods = [];
let foodIdCounter = 0;

// --- YEM SİSTEMİ ---
function spawnFood(count) {
    for (let i = 0; i < count; i++) {
        foods.push({
            id: foodIdCounter++,
            x: Math.random() * WORLD_SIZE,
            y: Math.random() * WORLD_SIZE,
            r: 5 + Math.random() * 3, // 5-8 yarıçap
            c: COLORS[Math.floor(Math.random() * COLORS.length)]
        });
    }
}
spawnFood(MAX_FOOD); // Başlangıç yemleri

// Yeni Oyuncu Bağlandığında
io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    socket.on('join_game', (data) => {
        const playerName = data.name || "Anonim";
        const spawnX = 200 + Math.random() * (WORLD_SIZE - 400);
        const spawnY = 200 + Math.random() * (WORLD_SIZE - 400);

        players[socket.id] = {
            id: socket.id,
            name: playerName,
            cells: [{ x: spawnX, y: spawnY, r: 30 }],
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            targetX: spawnX,
            targetY: spawnY
        };

        // Oyuncuya dünyayı yolla
        socket.emit('init_data', { id: socket.id, foods: foods });
        console.log(playerName + ' oyuna katıldı.');
    });

    // Oyuncu fare pozisyonunu gönderir → Sunucu hareket ettirir
    socket.on('player_move', (clientCells) => {
        let p = players[socket.id];
        if (!p || !clientCells || !clientCells.length) return;

        // Sadece pozisyon bilgisini güncelle (sunucu yarıçapı kontrol eder, hile önlenir)
        // Client'ın gönderdiği pozisyonu kabul et ama r (yarıçap) değerini ASLA kabul etme
        for (let i = 0; i < p.cells.length; i++) {
            if (clientCells[i]) {
                p.cells[i].x = Math.max(p.cells[i].r, Math.min(WORLD_SIZE - p.cells[i].r, clientCells[i].x));
                p.cells[i].y = Math.max(p.cells[i].r, Math.min(WORLD_SIZE - p.cells[i].r, clientCells[i].y));
            }
        }
    });

    // Oyuncu Çıktığında
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            console.log(players[socket.id].name + ' ayrıldı.');
            // Ölen oyuncunun kütlesini yeme dönüştür
            spawnPlayerCorpse(players[socket.id]);
            delete players[socket.id];
        }
    });
});

// Ölen/ayrılan oyuncunun hücrelerini yeme dönüştür
function spawnPlayerCorpse(player) {
    player.cells.forEach(cell => {
        // Hücre alanına orantılı yem üret
        let dropCount = Math.min(30, Math.floor(cell.r / 5));
        for (let i = 0; i < dropCount; i++) {
            let angle = Math.random() * Math.PI * 2;
            let dist = Math.random() * cell.r;
            foods.push({
                id: foodIdCounter++,
                x: Math.max(5, Math.min(WORLD_SIZE - 5, cell.x + Math.cos(angle) * dist)),
                y: Math.max(5, Math.min(WORLD_SIZE - 5, cell.y + Math.sin(angle) * dist)),
                r: 5 + Math.random() * 4,
                c: player.color
            });
        }
    });
}

// --- ANA OYUN DÖNGÜSÜ (30 FPS - Sunucu Tick) ---
setInterval(() => {
    let playerList = Object.values(players);

    // === YEM YEME KONTROLÜ ===
    playerList.forEach(p => {
        p.cells.forEach(cell => {
            for (let i = foods.length - 1; i >= 0; i--) {
                let f = foods[i];
                let dx = cell.x - f.x;
                let dy = cell.y - f.y;
                let distSq = dx * dx + dy * dy;

                // Hücre yemi yutabilecek kadar büyükse (hücre yarıçapı > yem yarıçapı)
                if (distSq < cell.r * cell.r) {
                    // BÜYÜME: Alan bazlı büyüme (Agar.io formülü)
                    // Yeni alan = eski alan + yem alanı
                    let cellArea = Math.PI * cell.r * cell.r;
                    let foodArea = Math.PI * f.r * f.r;
                    let newArea = cellArea + foodArea;
                    cell.r = Math.sqrt(newArea / Math.PI);

                    // Yemi sil ve herkese bildir
                    let eatenFoodId = f.id;
                    foods.splice(i, 1);
                    io.emit('food_eaten', eatenFoodId);
                }
            }
        });
    });

    // === OYUNCU YEME KONTROLÜ ===
    for (let i = 0; i < playerList.length; i++) {
        let predator = playerList[i];
        if (!players[predator.id]) continue; // Zaten ölmüş mü

        for (let j = 0; j < playerList.length; j++) {
            if (i === j) continue;
            let prey = playerList[j];
            if (!players[prey.id]) continue;

            // Her hücre çifti kontrol et
            for (let ci = predator.cells.length - 1; ci >= 0; ci--) {
                let pCell = predator.cells[ci];
                if (!pCell) continue;

                for (let cj = prey.cells.length - 1; cj >= 0; cj--) {
                    let eCell = prey.cells[cj];
                    if (!eCell) continue;

                    let dx = pCell.x - eCell.x;
                    let dy = pCell.y - eCell.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);

                    // Yutma koşulu: Avcı en az %25 daha büyük olmalı ve merkez mesafesi yeterli olmalı
                    if (pCell.r > eCell.r * 1.25 && dist < pCell.r - eCell.r * 0.4) {
                        // Avı yut: Alan transferi
                        let preyArea = Math.PI * eCell.r * eCell.r;
                        let predArea = Math.PI * pCell.r * pCell.r;
                        pCell.r = Math.sqrt((predArea + preyArea) / Math.PI);

                        // Avın bu hücresini sil
                        prey.cells.splice(cj, 1);

                        // Eğer avın hiç hücresi kalmadıysa → Oyundan çıkar
                        if (prey.cells.length === 0) {
                            io.to(prey.id).emit('eaten'); // Client'a "yendin" bildir
                            delete players[prey.id];
                        }
                    }
                }
            }
        }
    }

    // === DOĞAL KÜÇÜLME (Büyük hücreler yavaşça küçülür) ===
    playerList.forEach(p => {
        if (!players[p.id]) return;
        p.cells.forEach(cell => {
            if (cell.r > 40) {
                // Büyüklüğe orantılı küçülme (Agar.io mekaniği)
                cell.r -= cell.r * 0.0003; // Çok yavaş küçülme
            }
        });
    });

    // === YEM TAMAMLAMA ===
    if (foods.length < MAX_FOOD - 50) {
        spawnFood(Math.min(FOOD_SPAWN_RATE, MAX_FOOD - foods.length));
    }

    // Tüm oyunculara güncel durumu yolla
    io.emit('game_state', { players: players });

}, 1000 / 30); // 30 FPS (60 FPS gereksiz ağ yükü yaratıyordu)

// Her 5 saniyede yeni yemleri de yolla (Geç katılanlar için)
setInterval(() => {
    io.emit('new_foods', foods);
}, 5000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log('Mabed.io Server çalışıyor. Port:', PORT);
});
