const express = require("express");
const http = require("http");
const socketio = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;

// Variables de jeu
const FIELD_SIZE = 3000;
const BALL_COUNT = 60;
const BALL_RADIUS = 9;
const BALL_COLORS = [
  '#ffee24', '#ff529b', '#27ffe1', '#55cbfb',
  '#ffa252', '#ea68ff', '#39ffe1', '#c9ff57', '#ff3333'
];

// Les états des joueurs et billes
let players = {};
let balls = [];

// Génère une bille aléatoire
function genBall() {
  return {
    id: Math.random().toString(36).substr(2,9),
    x: Math.random() * (FIELD_SIZE - 80) + 40,
    y: Math.random() * (FIELD_SIZE - 80) + 40,
    color: BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)],
  };
}

// Démarre les billes du jeu
function resetBalls() {
  balls = [];
  for (let i = 0; i < BALL_COUNT; i++) balls.push(genBall());
}
resetBalls();

io.on("connection", (socket) => {
  // Connexion d'un joueur
  socket.on("join", (data) => {
    // data: {username, color}
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
    };
    // Snake initial
    for (let i = 0; i < 22; i++) {
      players[socket.id].snake.push({
        x: players[socket.id].x - i * 12,
        y: players[socket.id].y
      });
    }
    // Envoie la map actuelle et la liste des joueurs à ce nouveau joueur
    socket.emit("init", { 
      id: socket.id, 
      fieldSize: FIELD_SIZE,
      balls, 
      players: Object.values(players).map(p => ({
        id: p.id, username: p.username, color: p.color, x: p.x, y: p.y, snake: p.snake, score: p.score, dead: p.dead
      }))
    });
    // Informe les autres d'un nouveau joueur
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

  // Réception des mouvements d’un joueur
  socket.on("move", data => {
    if (!players[socket.id] || players[socket.id].dead) return;
    // data: {mouse:{x,y}}
    let p = players[socket.id];
    let head = p.snake[0];
    let dx = data.mouse.x - head.x;
    let dy = data.mouse.y - head.y;
    let dist = Math.hypot(dx, dy);
    let dir = Math.atan2(dy, dx);

    // Vitesse dépend de la longueur
    let speed = 4.6 - (p.length / 2600);
    if (speed < 2.1) speed = 2.1;
    let moveDist = Math.min(speed, dist);

    let nx = head.x + Math.cos(dir) * moveDist;
    let ny = head.y + Math.sin(dir) * moveDist;
    p.snake.unshift({ x: nx, y: ny });
    while (p.snake.length * 8 > p.length) p.snake.pop();
    p.x = nx;
    p.y = ny;
    p.direction = dir;

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
          // Mort !
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

  socket.on("restart", (data) => {
    if (!players[socket.id]) return;
    players[socket.id].dead = false;
    players[socket.id].score = 0;
    players[socket.id].length = 22*8;
    players[socket.id].x = FIELD_SIZE/2 + Math.random()*400 - 200;
    players[socket.id].y = FIELD_SIZE/2 + Math.random()*400 - 200;
    players[socket.id].snake = [];
    for (let i = 0; i < 22; i++) {
      players[socket.id].snake.push({
        x: players[socket.id].x - i * 12,
        y: players[socket.id].y
      });
    }
    io.emit("player_restart", { id: socket.id, x: players[socket.id].x, y: players[socket.id].y, snake: players[socket.id].snake });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("player_left", { id: socket.id });
  });
});

// Envoie l’état du jeu à tous (30 fois/sec)
setInterval(() => {
  io.emit("state", { players: players, balls: balls });
}, 1000/30);

// Sert les fichiers statiques
app.use(express.static("public"));

server.listen(PORT, () => {
  console.log(`Serveur Slither.io clone en écoute sur http://localhost:${PORT}`);
});
