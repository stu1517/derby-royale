const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// === 遊戲設定 ===
let TARGET_CLICKS = 1000; // 預設目標點擊數
const TOTAL_HORSES = 5;

// 馬匹資料初始化
const horseConfig = [
    { id: 0, name: "薪水小偷", icon: "🐹", desc: "擅長帶薪大便，速度取決於老闆是否在背後，爆發力謎樣。" },
    { id: 1, name: "爆肝代碼", icon: "🧟", desc: "靠腎上腺素與咖啡因驅動，黑眼圈越深跑得越快！" },
    { id: 2, name: "甩鍋大王", icon: "🍳", desc: "責任閃避點滿，遇到障礙會自動滑過去，物理法則無效。" },
    { id: 3, name: "準時下班", icon: "🏃", desc: "下午 5:59 分擁有光速般的移動力，誰都攔不住！" },
    { id: 4, name: "年終加倍", icon: "💰", desc: "散發著金錢的氣息，為了紅包可以突破肉體極限。" }
];

// 遊戲狀態
let players = new Map(); // socket.id -> { name, horseId }
let raceState = {
    started: false,
    startTime: 0,
    finishedCount: 0,
    horses: [] // 儲存每匹馬的 score, finishTime, rank
};

// 初始化賽局
function initRace() {
    raceState.started = false;
    raceState.finishedCount = 0;
    raceState.startTime = 0;
    raceState.horses = horseConfig.map(h => ({
        ...h,
        score: 0,
        finished: false,
        finishTime: null, // 毫秒
        rank: null
    }));
}
initRace();

io.on('connection', (socket) => {
    
    // 1. 玩家登入
    socket.on('login', (name) => {
        players.set(socket.id, { name: name, horseId: -1 }); // -1 代表未選
        socket.emit('loginSuccess', horseConfig); // 傳送馬匹資訊給前端
    });

    // 2. 選擇馬匹
    socket.on('selectHorse', (horseId) => {
        const player = players.get(socket.id);
        if (player) {
            player.horseId = horseId;
            socket.emit('waitingForStart', horseConfig[horseId]);
            updateAdminStats();
        }
    });

    /*
    // 3. 點擊奔跑    
    socket.on('clickRun', () => {
        if (!raceState.started) return;
        const player = players.get(socket.id);
        if (!player || player.horseId === -1) return;

        const hIndex = player.horseId;
        const horse = raceState.horses[hIndex];

        // 如果這匹馬還沒跑完，增加分數
        if (!horse.finished) {
            horse.score++;
            
            // 檢查是否到達終點
            if (horse.score >= TARGET_CLICKS) {
                horse.score = TARGET_CLICKS;
                horse.finished = true;
                horse.finishTime = Date.now() - raceState.startTime;
                raceState.finishedCount++;
                horse.rank = raceState.finishedCount;

                // 廣播某匹馬跑完了
                io.emit('horseFinished', { 
                    id: hIndex, 
                    rank: horse.rank, 
                    time: (horse.finishTime / 1000).toFixed(2) 
                });

                // 全部跑完
                if (raceState.finishedCount >= TOTAL_HORSES) {
                    endGame();
                }
            }
        }
    });
    */

    // 3. 點擊奔跑 (修改版)
    socket.on('clickRun', () => {
        if (!raceState.started) return;
        const player = players.get(socket.id);
        if (!player || player.horseId === -1) return;

        const hIndex = player.horseId;
        const horse = raceState.horses[hIndex];

        // 如果這匹馬還沒跑完，增加分數
        if (!horse.finished) {
            horse.score++;
            
            // 檢查是否到達終點
            if (horse.score >= TARGET_CLICKS) {
                horse.score = TARGET_CLICKS;
                horse.finished = true;
                horse.finishTime = Date.now() - raceState.startTime;
                
                // 設定為第 1 名
                horse.rank = 1; 

                // 廣播冠軍產生
                io.emit('horseFinished', { 
                    id: hIndex, 
                    rank: 1, 
                    time: (horse.finishTime / 1000).toFixed(2) 
                });

                // === 關鍵修改：只要有一匹馬跑完，直接結束遊戲 ===
                endGame();
            }
        }
    });




    // --- 管理員指令 ---
    socket.on('adminAction', (data) => {
        const { action, value } = data;
        
        if (action === 'start') {
            startGame();
        } else if (action === 'reset') {
            initRace();
            // 重置玩家選擇
            players.forEach(p => p.horseId = -1);
            io.emit('resetGame');
        } else if (action === 'setTarget') {
            TARGET_CLICKS = parseInt(value);
            console.log(`Target clicks set to ${TARGET_CLICKS}`);
            io.emit('configUpdate', TARGET_CLICKS);
        }
    });

    socket.on('disconnect', () => {
        players.delete(socket.id);
        updateAdminStats();
    });
});

// 每 100ms 廣播一次賽況，避免網路擁塞
setInterval(() => {
    if (raceState.started && raceState.finishedCount < TOTAL_HORSES) {
        // 只傳送分數百分比
        const progress = raceState.horses.map(h => ({
            id: h.id,
            percent: (h.score / TARGET_CLICKS) * 100
        }));
        io.emit('updateProgress', progress);
    }
}, 100);

function startGame() {
    if (raceState.started) return;
    initRace(); // 確保狀態乾淨（但不清空玩家）
    raceState.started = true;
    raceState.startTime = Date.now();
    io.emit('gameStart');
}

/*
function endGame() {
    raceState.started = false;
    
    // 整理結果：第一名的馬，以及選中該馬的玩家
    const winnerHorse = raceState.horses.find(h => h.rank === 1);
    const winners = [];
    players.forEach(p => {
        if (p.horseId === winnerHorse.id) winners.push(p.name);
    });

    io.emit('gameOver', {
        horses: raceState.horses, // 包含所有成績
        winnerName: winnerHorse.name,
        luckyPlayers: winners
    });
}
    */

// 修改後的結束遊戲邏輯
function endGame() {
    raceState.started = false;
    
    // 1. 結算排名
    // 因為只有一匹馬跑完(冠軍)，我們需要手動計算其他馬的名次(2~5名)
    // 邏輯：已完成的排前面，未完成的依照分數(score)由高到低排
    
    // 建立一個暫存陣列來排序，避免打亂原始 id 順序
    let sortedResult = [...raceState.horses].sort((a, b) => {
        if (a.finished && !b.finished) return -1; // a 排前
        if (!a.finished && b.finished) return 1;  // b 排前
        return b.score - a.score; // 分數高的排前
    });

    // 將排名寫回原始資料
    sortedResult.forEach((h, index) => {
        // 透過 id 找到原始物件並寫入 rank
        const originalHorse = raceState.horses.find(oh => oh.id === h.id);
        originalHorse.rank = index + 1;
    });

    // 2. 找出冠軍 (Rank 1)
    const winnerHorse = raceState.horses.find(h => h.rank === 1);
    
    // 3. 找出中獎玩家
    const winners = [];
    players.forEach(p => {
        if (p.horseId === winnerHorse.id) winners.push(p.name);
    });

    io.emit('gameOver', {
        horses: raceState.horses, // 包含所有成績與計算好的排名
        winnerName: winnerHorse.name,
        luckyPlayers: winners
    });
}

function updateAdminStats() {
    // 統計每匹馬的擁護者數量 (可選功能)
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Derby Royale running on port ${PORT}`);
});