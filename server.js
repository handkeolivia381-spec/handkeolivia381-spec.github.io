/**
 * Mathland MMORPG - Part 1 Backend Server
 * File: server.js
 * * An authoritative game server built with Node.js, Express, and Socket.io.
 * This server tracks player states, manages real-time movement replication,
 * and hosts a secure, server-side math engine to prevent cheating.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const PORT = process.env.PORT || 3000;
const TICK_RATE = 20; // 20 updates per second (50ms interval)

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
// 2. MATH LAND ENGINE (Server-Authoritative)
// ==========================================
/**
 * Generates an algebraic equation challenge tailored to player level.
 * Formula structures scale in complexity:
 * Level 1-3: Simple arithmetic (e.g., $a + b = x$)
 * Level 4-7: Single-step algebra (e.g., $ax = b$)
 * Level 8+: Two-step algebra (e.g., $ax + b = c$)
 * * @param {number} level - The level of the player.
 * @returns {Object} { equationText: string, expectedAnswer: number }
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
        // Designed to avoid fractional division answers
        const x = Math.floor(Math.random() * 10) + 1; // Integer answer
        const a = Math.floor(Math.random() * 8) + 2;
        const b = a * x;
        
        return {
            equation: `${a}x = ${b}  (Solve for x)`,
            answer: x,
            type: 'basic_algebra'
        };
    } else {
        // Two-step Algebra: ax + b = c
        const x = Math.floor(Math.random() * 12) + 1; // Integer answer
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
    console.log(`[MATHLAND] Wizard connected: ${socket.id}`);

    // Create default player state
    gameState.players[socket.id] = {
        id: socket.id,
        username: `Apprentice_${socket.id.substring(0, 4)}`,
        x: 100,
        y: 100,
        hp: 100,
        maxHp: 100,
        level: 1,
        xp: 0,
        gold: 0,
        zone: "arithmetic_meadow",
        targetMonsterId: null,
        activeChallenge: null, // Holds current { equation, answer } verification data
    };

    // Send initial handshake data containing everything on the server
    socket.emit('init', {
        yourId: socket.id,
        players: gameState.players,
        monsters: gameState.monsters
    });

    // Broadcast new player to others
    socket.broadcast.emit('player_joined', gameState.players[socket.id]);

    // Handle real-time Movement input validation
    socket.on('player_move', (data) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        // Authoritative server coordinates validation (clamping to hypothetical bounds)
        player.x = Math.max(0, Math.min(2000, data.x));
        player.y = Math.max(0, Math.min(2000, data.y));
    });

    // Handle Battle request (Clicking a monster creates a secure equation)
    socket.on('target_monster', (data) => {
        const player = gameState.players[socket.id];
        const monster = gameState.monsters[data.monsterId];

        if (!player || !monster) return;

        player.targetMonsterId = monster.id;
        
        // Generate equation tailored to current level of the player
        const challenge = generateEquation(player.level);
        player.activeChallenge = challenge;

        console.log(`[MATHLAND] Challenge generated for ${player.username}: ${challenge.equation} (Secret Answer: ${challenge.answer})`);

        // Emit challenge back to client ONLY (keep secret answer server-side!)
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

            // Check level up (e.g., Level Up at every multiple of 100 XP)
            const oldLevel = player.level;
            player.level = Math.floor(player.xp / 100) + 1;
            const leveledUp = player.level > oldLevel;

            if (leveledUp) {
                player.maxHp += 20;
                player.hp = player.maxHp;
            }

            // Damage monster
            if (monster) {
                monster.hp = Math.max(0, monster.hp - dmg);
                
                // If monster is defeated, reset it after a delay
                if (monster.hp <= 0) {
                    io.emit('chat_message', {
                        sender: "System",
                        message: `🎉 ${player.username} defeated ${monster.name}! (+${xpGained} XP, +${goldGained} Gold)`
                    });

                    // Simple respawn loop
                    setTimeout(() => {
                        monster.hp = monster.maxHp;
                        io.emit('monster_respawned', monster);
                    }, 5000);
                }
            }

            // Clear challenge on success
            player.activeChallenge = null;
            player.targetMonsterId = null;

            // Report results
            socket.emit('answer_result', {
                correct: true,
                damage: dmg,
                xpGained,
                goldGained,
                leveledUp,
                newLevel: player.level,
                playerState: player
            });

            // Update entire game lobby about the combat action
            io.emit('player_combat_action', {
                playerId: player.id,
                monsterId: monster ? monster.id : null,
                damage: dmg,
                monsterHp: monster ? monster.hp : 0
            });

        } else {
            // Incorrect answer: Monster strikes back!
            let incomingDmg = 10 + (monster ? monster.level * 2 : 5);
            player.hp = Math.max(0, player.hp - incomingDmg);

            if (player.hp <= 0) {
                // Defeat punishment: respawn at coordinates
                player.hp = player.maxHp;
                player.x = 100;
                player.y = 100;
                player.xp = Math.max(0, player.xp - 20); // Lose some XP

                socket.emit('player_died', {
                    message: "You were mathematically defeated and sent back to spawn! Lose 20 XP."
                });
            }

            // Keep the active equation open so they can retry or request a new target,
            // but punish their HP for wrong answer.
            socket.emit('answer_result', {
                correct: false,
                damage: incomingDmg,
                playerState: player
            });
        }
    });

    // Chat room messaging
    socket.on('send_chat', (msg) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        io.emit('chat_message', {
            sender: player.username,
            message: msg.substring(0, 100) // Sanitize length
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
    });

    // Clean up state on disconnect
    socket.on('disconnect', () => {
        console.log(`[MATHLAND] Wizard left: ${socket.id}`);
        delete gameState.players[socket.id];
        io.emit('player_left', socket.id);
    });
});

// ==========================================
// 4. TICK SYSTEM (Sync positions real-time)
// ==========================================
setInterval(() => {
    // Send lightweight snapshot containing only positions & vital stats of elements
    const snapshot = {
        players: {},
        monsters: {}
    };

    // Construct streamlined players snapshot
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

    // Construct streamlined monsters snapshot
    for (const [id, monster] of Object.entries(gameState.monsters)) {
        snapshot.monsters[id] = {
            id: monster.id,
            hp: monster.hp,
            maxHp: monster.maxHp
        };
    }

    // Broadcast state update to everyone connected
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
