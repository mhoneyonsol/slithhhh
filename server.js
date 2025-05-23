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
      snake: [],
      direction: 0,
      length: 22*8,
      dead: false,
      score: 0,
      lastDir: Math.random()*Math.PI*2 // Pour direction de départ
    };
    for (let i = 0; i < 22; i++) {
      players[socket.id].snake.push({
        x: players[socket.id].x - i * 12 * Math.cos(players[socket.id].lastDir),
        y: players[socket.id].y - i * 12 * Math.sin(players[socket.id].lastDir)
      });
    }
    socket.emit("init", { 
      id: socket.id, 
      fieldSize: FIELD_SIZE,
      balls, 
      players: Object.values(players).map(p => ({
        id: p.id, username: p.username, color: p.color, x: p.x, y: p.y, snake: p.snake, score: p.score, dead: p.dead
      }))
    });
    socket.broadcast.emit("player_joined", {
      id: socket.id, 
      username: players[socket.id].username, 
      color: players[socket.id].color, 
      x: players[socket.id].x, 
      y: players[socket.id].y,
      snake: players[socket.id].snake,
      score: 0,
      dead: false,
    });
  });

  socket.on("move", data => {
    if (!players[socket.id] || players[socket.id].dead) return;
    let p = players[socket.id];
    let head = p.snake[0];
    let targetDir;
    // Même si la souris ne bouge pas, garder la direction précédente
    if (data && data.mouse) {
      let dx = data.mouse.x - head.x;
      let dy = data.mouse.y - head.y;
      targetDir = Math.atan2(dy, dx);
      // Si la souris ne bouge pas (pile sur la tête), garder la dernière direction
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
        targetDir = p.lastDir;
      } else {
        p.lastDir = targetDir;
      }
    } else {
      targetDir = p.lastDir;
    }

    // Vitesse dépend de la longueur
    let speed = 4.7 - (p.length / 2600);
    if (speed < 2.1) speed = 2.1;
    // Toujours bouger !
    let nx = head.x + Math.cos(targetDir) * speed;
    let ny = head.y + Math.sin(targetDir) * speed;

    p.snake.unshift({ x: nx, y: ny });
    while (p.snake.length * 8 > p.length) p.snake.pop();
    p.x = nx;
    p.y = ny;
    p.direction = targetDir;

    // Bords : mort
    if (
      nx < 14 ||
      nx > FIELD_SIZE - 14 ||
      ny < 14 ||
      ny > FIELD_SIZE - 14
    ) {
      p.dead = true;
      io.emit("player_dead", { id: socket.id, score: p.score, reason: "border" });
      return;
    }

    // Mange une bille ?
    for (let i = 0; i < balls.length; i++) {
      let b = balls[i];
      let distToBall = Math.hypot(nx - b.x, ny - b.y);
      if (distToBall < BALL_RADIUS + 14 - 4) {
        p.length += 17;
        p.score += 1;
        io.emit("eat_ball", { playerId: socket.id, ballId: b.id });
        balls[i] = genBall();
        break;
      }
    }

    // Collision avec les autres serpents ?
    for (let oid in players) {
      if (oid === socket.id) continue;
      let other = players[oid];
      if (other.dead) continue;
      for (let seg of other.snake.slice(10)) {
        if (Math.hypot(nx - seg.x, ny - seg.y) < 12) {
          p.dead = true;
          io.emit("player_dead", { id: socket.id, score: p.score, reason: "hit" });
          return;
        }
      }
    }
  });

  socket.on("request_balls", () => {
    socket.emit("update_balls", balls);
  });

  socket.on("restart", () => {
    if (!players[socket.id]) return;
    players[socket.id].dead = false;
    players[socket.id].score = 0;
    players[socket.id].length = 22*8;
    players[socket.id].x = FIELD_SIZE/2 + Math.random()*400 - 200;
    players[socket.id].y = FIELD_SIZE/2 + Math.random()*400 - 200;
    players[socket.id].lastDir = Math.random()*Math.PI*2;
    players[socket.id].snake = [];
    for (let i = 0; i < 22; i++) {
      players[socket.id].snake.push({
        x: players[socket.id].x - i * 12 * Math.cos(players[socket.id].lastDir),
        y: players[socket.id].y - i * 12 * Math.sin(players[socket.id].lastDir)
      });
    }
    io.emit("player_restart", { id: socket.id, x: players[socket.id].x, y: players[socket.id].y, snake: players[socket.id].snake });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("player_left", { id: socket.id });
  });
});

setInterval(() => {
  io.emit("state", { players: players, balls: balls });
}, 1000/40); // 40 FPS pour une meilleure fluidité

app.use(express.static("public"));

server.listen(PORT, () => {
  console.log(`Serveur Slither.io clone en écoute sur http://localhost:${PORT}`);
});
