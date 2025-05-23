const express = require("express");
const http = require("http");
const socketio = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;
const FIELD_SIZE = 3000;
const BALL_COUNT = 60;
const BALL_RADIUS = 9;
const BALL_COLORS = [
  '#ffee24', '#ff529b', '#27ffe1', '#55cbfb',
  '#ffa252', '#ea68ff', '#39ffe1', '#c9ff57', '#ff3333'
];

let players = {};
let balls = [];

function genBall() {
  return {
    id: Math.random().toString(36).substr(2,9),
    x: Math.random() * (FIELD_SIZE - 80) + 40,
    y: Math.random() * (FIELD_SIZE - 80) + 40,
    color: BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)],
    anim: 0, // pour pop visuel
  };
}
function resetBalls() {
  balls = [];
  for (let i = 0; i < BALL_COUNT; i++) balls.push(genBall());
}
resetBalls();

io.on("connection", (socket) => {
  socket.on("join", (data) => {
    players[socket.id] = {
      id: socket.id,
      username: data.username.slice(0, 16),
      color: data.color || "#39ffe1",
      x: FIELD_SIZE / 2 + Math.random()*400 - 200,
      y: FIELD_SIZE / 2 + Math.random()*400 - 200,
      dir: Math.random()*Math.PI*2,
      desiredDir: null,
      snake: [],
      length: 22*8,
      dead: false,
      score: 0,
      lastUpdate: Date.now(),
      boosting: false,
      boostReserve: 1,
      particles: [],
    };
    let p = players[socket.id];
    p.desiredDir = p.dir;
    for (let i = 0; i < 22; i++) {
      p.snake.push({
        x: p.x - i * 12 * Math.cos(p.dir),
        y: p.y - i * 12 * Math.sin(p.dir)
      });
    }
    socket.emit("init", { 
      id: socket.id, 
      fieldSize: FIELD_SIZE,
      balls, 
      players: Object.values(players).map(p => ({
        id: p.id, username: p.username, color: p.color, snake: p.snake, score: p.score, dead: p.dead, boosting: p.boosting
      }))
    });
    socket.broadcast.emit("player_joined", {
      id: socket.id, 
      username: p.username, 
      color: p.color, 
      snake: p.snake,
      score: 0,
      dead: false,
      boosting: false,
    });
  });

  socket.on("move", data => {
    if (!players[socket.id] || players[socket.id].dead) return;
    let p = players[socket.id];
    let head = p.snake[0];
    // Calcule l'angle voulu seulement quand la souris bouge
    if (data && data.mouse && typeof data.mouse.x === "number" && typeof data.mouse.y === "number") {
      let dx = data.mouse.x - head.x;
      let dy = data.mouse.y - head.y;
      let angleTarget = Math.atan2(dy, dx);
      p.desiredDir = angleTarget;
    }
    if (typeof data.boost === "boolean") {
      p.boosting = data.boost;
    }
  });

  socket.on("request_balls", () => {
    socket.emit("update_balls", balls);
  });

  socket.on("restart", () => {
    if (!players[socket.id]) return;
    let p = players[socket.id];
    p.dead = false;
    p.score = 0;
    p.length = 22*8;
    p.x = FIELD_SIZE/2 + Math.random()*400 - 200;
    p.y = FIELD_SIZE/2 + Math.random()*400 - 200;
    p.dir = Math.random()*Math.PI*2;
    p.desiredDir = p.dir;
    p.snake = [];
    p.boosting = false;
    for (let i = 0; i < 22; i++) {
      p.snake.push({
        x: p.x - i * 12 * Math.cos(p.dir),
        y: p.y - i * 12 * Math.sin(p.dir)
      });
    }
    io.emit("player_restart", { id: socket.id, snake: p.snake });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("player_left", { id: socket.id });
  });
});

// Avance TOUS les serpents à chaque tick, même sans input souris
setInterval(() => {
  for (const id in players) {
    const p = players[id];
    if (p.dead) continue;

    // Boost
    let isBoost = !!p.boosting && p.length > 22*8+24;
    let boostSpeed = isBoost ? 2.05 : 1;
    if (isBoost) {
      p.length -= 1.2;
      if (p.length < 22*8) p.length = 22*8;
      p.boostReserve -= 0.02;
      if (p.boostReserve < 0) p.boostReserve = 0;
      // Traînée de particules
      if (Math.random() < 0.85) {
        p.particles.push({
          x: p.snake[0].x, y: p.snake[0].y,
          t: 1, col: p.color
        });
      }
    } else {
      p.boostReserve += 0.009;
      if (p.boostReserve > 1) p.boostReserve = 1;
    }

    // Inertie direction
    let dAngle = ((p.desiredDir - p.dir + Math.PI*3) % (Math.PI*2)) - Math.PI;
    p.dir += dAngle * 0.09;

    // Vitesse
    let minSpeed = 2.1, maxSpeed = 3.1;
    let baseLength = 22*8;
    let speed = (maxSpeed - (p.length - baseLength) * 0.0017) * boostSpeed;
    if (speed < minSpeed) speed = minSpeed;

    // Mouvement
    let head = p.snake[0];
    let nx = head.x + Math.cos(p.dir) * speed;
    let ny = head.y + Math.sin(p.dir) * speed;

    p.snake.unshift({ x: nx, y: ny });
    while (p.snake.length * 8 > p.length) p.snake.pop();
    p.x = nx;
    p.y = ny;

    // Bords
    if (
      nx < 14 || nx > FIELD_SIZE - 14 ||
      ny < 14 || ny > FIELD_SIZE - 14
    ) {
      p.dead = true;
      io.emit("player_dead", { id: p.id, score: p.score, reason: "border" });
      continue;
    }

    // Mange une bille ?
    for (let i = 0; i < balls.length; i++) {
      let b = balls[i];
      let distToBall = Math.hypot(nx - b.x, ny - b.y);
      if (distToBall < BALL_RADIUS + 14 - 4) {
        p.length += 17;
        p.score += 1;
        balls[i].anim = 1.1; // marque comme "pop"
        io.emit("eat_ball", { playerId: p.id, ballId: b.id });
        balls[i] = {...genBall(), anim: 1.1}; // nouvelle bille, anim = pop
        break;
      }
    }

    // Collision avec autres serpents
    for (let oid in players) {
      if (oid === id) continue;
      let other = players[oid];
      if (other.dead) continue;
      for (let seg of other.snake.slice(10)) {
        if (Math.hypot(nx - seg.x, ny - seg.y) < 12) {
          p.dead = true;
          io.emit("player_dead", { id: p.id, score: p.score, reason: "hit" });
          break;
        }
      }
      if (p.dead) break;
    }

    // MAJ particules boost
    p.particles = p.particles.filter(pt => {
      pt.t -= 0.04;
      return pt.t > 0;
    });

    p.lastUpdate = Date.now();
  }

  // Animation des billes pop
  balls.forEach(b => { if (b.anim > 0) b.anim -= 0.13; });

  // Leaderboard
  let leaderboard = Object.values(players)
    .filter(p => !p.dead)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({id: p.id, username: p.username, score: p.score, color: p.color}));

  io.emit("state", {
    now: Date.now(),
    players: Object.fromEntries(Object.entries(players).map(([id, p]) => [
      id, { 
        id: p.id,
        username: p.username,
        color: p.color,
        score: p.score,
        dead: p.dead,
        snake: p.snake.slice(0, 42),
        boosting: p.boosting,
        boostReserve: p.boostReserve,
        particles: p.particles.slice(0, 40)
      }
    ])),
    balls: balls.map(b => ({...b})),
    leaderboard
  });
}, 1000/32);

app.use(express.static("public"));

server.listen(PORT, () => {
  console.log(`Serveur Slither.io clone en écoute sur http://localhost:${PORT}`);
});
