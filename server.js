/**
 * Mathland MMORPG - Part 1 Backend Server
 * File: server.js
 * An authoritative game server built with Node.js, Express, and Socket.io.
 * This server tracks player states, manages real-time movement replication,
 * and hosts a secure, server-side math engine to prevent cheating.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const PORT = process.env.PORT || 3000;
const TICK_RATE = 20; // 20 updates per second (50ms interval)
const DB_FILE = path.join(__dirname, 'players_db.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Adjust in production to restrict domains
        methods: ["GET", "POST"]
    }
});

// Serve static assets from the current directory (for index.html, styles, etc.)
app.use(express.static(__dirname));

// Serve the interactive index.html MMORPG client
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// In-Memory Game State (State-Authoritative model)
const gameState = {
    players: {},   // Key: socket.id, Value: Player state object
    monsters: {},  // Key: monsterId, Value: Monster state object
    zones: {       // Mathland maps/zones
        "arithmetic_meadow": { name: "Arithmetic Meadow", levelMin: 1, levelMax: 5 },
        "algebra_abyss": { name: "Algebra Abyss", levelMin: 6, levelMax: 12 }
    }
};

// ==========================================
// PERSISTENCE STORAGE CONTROLLERS
// ==========================================
/**
 * Reads local player profiles database.
 */
function loadPlayerDb() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (err) {
        console.error("[MATHLAND] Error reading database file:", err);
    }
    return {};
}

/**
 * Commits the database back to local disk.
 */
function savePlayerDb(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error("[MATHLAND] Error writing database file:", err);
    }
}

/**
 * Commits an individual player's current progression state.
 */
function savePlayerProgress(player) {
    if (!player || !player.uid) return;
    const db = loadPlayerDb();
    db[player.uid] = {
        username: player.username,
        x: player.x,
        y: player.y,
        hp: player.hp,
        maxHp: player.maxHp,
        level: player.level,
        xp: player.xp,
        gold: player.gold,
        zone: player.zone
    };
    savePlayerDb(db);
}

// ==========================================
// 2. MATH LAND ENGINE (Server-Authoritative)
// ==========================================
/**
 * Generates an algebraic equation challenge tailored to player level.
 */
function generateEquation(level) {
    if (level < 4) {
        // Simple Arithmetic: a + b = c
        const a = Math.floor(Math.random() * 20) + 1;
        const b = Math.floor(Math.random() * 20) + 1;
        const op = Math.random() > 0.5 ? '+' : '-';
        const result = op === '+' ? a + b : a - b;
        
        return {
            equation: `${a} ${op} ${b} = ?`,
            answer: result,
            type: 'arithmetic'
        };
    } else if (level < 8) {
        // Single-step Algebra: ax = b
        const x = Math.floor(Math.random() * 10) + 1; 
        const a = Math.floor(Math.random() * 8) + 2;
        const b = a * x;
        
        return {
            equation: `${a}x = ${b}  (Solve for x)`,
            answer: x,
            type: 'basic_algebra'
        };
    } else {
        // Two-step Algebra: ax + b = c
        const x = Math.floor(Math.random() * 12) + 1; 
        const a = Math.floor(Math.random() * 6) + 2;
        const b = Math.floor(Math.random() * 20) + 1;
        const sign = Math.random() > 0.5 ? '+' : '-';
        
        const c = sign === '+' ? (a * x) + b : (a * x) - b;
        
        return {
            equation: `${a}x ${sign} ${b} = ${c}  (Solve for x)`,
            answer: x,
            type: 'two_step_algebra'
        };
    }
}

// Seed initial monsters for Arithmetic Meadow (Zone 1)
function spawnMonsters() {
    const names = ["Fraction Fungus", "Linear Lurker", "Cosine Crag", "Divisor Devil"];
    names.forEach((name, idx) => {
        const id = `monster_${idx}`;
        gameState.monsters[id] = {
            id: id,
            name: name,
            level: 3,
            hp: 100,
            maxHp: 100,
            x: 200 + (idx * 150),
            y: 300,
            zone: "arithmetic_meadow"
        };
    });
}
spawnMonsters();

// ==========================================
// 3. SOCKET.IO MULTIPLAYER HANDLERS
// ==========================================
io.on('connection', (socket) => {
    console.log(`[MATHLAND] Connection established: ${socket.id}`);

    // Wait for the client to authenticate and register UID
    socket.on('player_join', (data) => {
        const uid = data.uid || `guest_${socket.id}`;
        const username = data.username || `Apprentice_${socket.id.substring(0, 4)}`;

        const db = loadPlayerDb();
        const savedProfile = db[uid] || {};

        // Merge loaded stats with defaults
        gameState.players[socket.id] = {
            id: socket.id,
            uid: uid,
            username: savedProfile.username || username,
            x: savedProfile.x !== undefined ? savedProfile.x : 100,
            y: savedProfile.y !== undefined ? savedProfile.y : 100,
            hp: savedProfile.hp !== undefined ? savedProfile.hp : 100,
            maxHp: savedProfile.maxHp !== undefined ? savedProfile.maxHp : 100,
            level: savedProfile.level !== undefined ? savedProfile.level : 1,
            xp: savedProfile.xp !== undefined ? savedProfile.xp : 0,
            gold: savedProfile.gold !== undefined ? savedProfile.gold : 0,
            zone: savedProfile.zone || "arithmetic_meadow",
            targetMonsterId: null,
            activeChallenge: null, 
        };

        const player = gameState.players[socket.id];
        console.log(`[MATHLAND] Loaded saved profile for ${player.username} (Level ${player.level})`);

        // Send handshake confirmation containing initialization context
        socket.emit('init', {
            yourId: socket.id,
            players: gameState.players,
            monsters: gameState.monsters
        });

        // Broadcast presence
        socket.broadcast.emit('player_joined', player);

        // Commit profile immediately
        savePlayerProgress(player);
    });

    // Handle real-time Movement input validation
    socket.on('player_move', (data) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        player.x = Math.max(0, Math.min(2000, data.x));
        player.y = Math.max(0, Math.min(2000, data.y));
    });

    // Handle Battle request
    socket.on('target_monster', (data) => {
        const player = gameState.players[socket.id];
        const monster = gameState.monsters[data.monsterId];

        if (!player || !monster) return;

        player.targetMonsterId = monster.id;
        
        const challenge = generateEquation(player.level);
        player.activeChallenge = challenge;

        console.log(`[MATHLAND] Challenge for ${player.username}: ${challenge.equation} (Secret Answer: ${challenge.answer})`);

        // Emit public presentation to client only
        socket.emit('equation_challenge', {
            monsterId: monster.id,
            equation: challenge.equation
        });
    });

    // Handle Math Answer verification
    socket.on('submit_answer', (data) => {
        const player = gameState.players[socket.id];
        if (!player || !player.activeChallenge) return;

        const submitted = parseFloat(data.answer);
        const correct = player.activeChallenge.answer;

        const isCorrect = (submitted === correct);
        const monster = gameState.monsters[player.targetMonsterId];

        if (isCorrect) {
            let dmg = player.level * 15 + Math.floor(Math.random() * 10);
            let xpGained = 10;
            let goldGained = 5;

            player.xp += xpGained;
            player.gold += goldGained;

            // Check level up (100 XP boundaries)
            const oldLevel = player.level;
            player.level = Math.floor(player.xp / 100) + 1;
            const leveledUp = player.level > oldLevel;

            if (leveledUp) {
                player.maxHp += 20;
                player.hp = player.maxHp;
            }

            if (monster) {
                monster.hp = Math.max(0, monster.hp - dmg);
                
                if (monster.hp <= 0) {
                    io.emit('chat_message', {
                        sender: "System",
                        message: `🎉 ${player.username} defeated ${monster.name}! (+${xpGained} XP, +${goldGained} Gold)`
                    });

                    setTimeout(() => {
                        monster.hp = monster.maxHp;
                        io.emit('monster_respawned', monster);
                    }, 5000);
                }
            }

            player.activeChallenge = null;
            player.targetMonsterId = null;

            socket.emit('answer_result', {
                correct: true,
                damage: dmg,
                xpGained,
                goldGained,
                leveledUp,
                newLevel: player.level,
                playerState: player
            });

            io.emit('player_combat_action', {
                playerId: player.id,
                monsterId: monster ? monster.id : null,
                damage: dmg,
                monsterHp: monster ? monster.hp : 0
            });

            // Auto-Save progress upon successful math solutions
            savePlayerProgress(player);

        } else {
            // Incorrect answer
            let incomingDmg = 10 + (monster ? monster.level * 2 : 5);
            player.hp = Math.max(0, player.hp - incomingDmg);

            if (player.hp <= 0) {
                player.hp = player.maxHp;
                player.x = 100;
                player.y = 100;
                player.xp = Math.max(0, player.xp - 20); // Penalty

                socket.emit('player_died', {
                    message: "You were mathematically defeated and sent back to spawn! Lose 20 XP."
                });
            }

            socket.emit('answer_result', {
                correct: false,
                damage: incomingDmg,
                playerState: player
            });

            // Auto-Save progress on failure
            savePlayerProgress(player);
        }
    });

    // Chat room messaging
    socket.on('send_chat', (msg) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        io.emit('chat_message', {
            sender: player.username,
            message: msg.substring(0, 100)
        });
    });

    // Handle manual nickname adjustments
    socket.on('set_username', (data) => {
        const player = gameState.players[socket.id];
        if (!player || !data.username) return;

        const oldName = player.username;
        player.username = data.username.substring(0, 15).replace(/[^a-zA-Z0-9_ ]/g, "");
        
        io.emit('chat_message', {
            sender: "System",
            message: `🧙‍♂️ ${oldName} is now known as ${player.username}`
        });

        io.emit('player_updated', player);
        savePlayerProgress(player);
    });

    // Clean up state on disconnect
    socket.on('disconnect', () => {
        const player = gameState.players[socket.id];
        if (player) {
            console.log(`[MATHLAND] Wizard left: ${socket.id}`);
            savePlayerProgress(player); // Commit final details to database.json
            delete gameState.players[socket.id];
            io.emit('player_left', socket.id);
        }
    });
});

// ==========================================
// 4. TICK SYSTEM (Sync positions real-time)
// ==========================================
setInterval(() => {
    const snapshot = {
        players: {},
        monsters: {}
    };

    for (const [id, player] of Object.entries(gameState.players)) {
        snapshot.players[id] = {
            id: player.id,
            username: player.username,
            x: player.x,
            y: player.y,
            hp: player.hp,
            maxHp: player.maxHp,
            level: player.level,
            xp: player.xp,
            gold: player.gold
        };
    }

    for (const [id, monster] of Object.entries(gameState.monsters)) {
        snapshot.monsters[id] = {
            id: monster.id,
            hp: monster.hp,
            maxHp: monster.maxHp
        };
    }

    io.emit('state_update', snapshot);

}, 1000 / TICK_RATE);

// ==========================================
// 5. SERVER RUNTIME
// ==========================================
server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  📐 Mathland Authoritative Game Server Online 📐`);
    console.log(`  Port: http://localhost:${PORT}`);
    console.log(`  Tick Rate: ${TICK_RATE} Hz`);
    console.log(`======================================================\n`);
});
