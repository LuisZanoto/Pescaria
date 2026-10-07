(() => {
  "use strict";

  const canvas = document.querySelector("#river");
  const ctx = canvas.getContext("2d");
  const overlay = document.querySelector("#overlay");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");
  const startButton = document.querySelector("#start-button");
  const buttonLabel = document.querySelector("#button-label");
  const distanceLabel = document.querySelector("#distance");
  const speedLabel = document.querySelector("#speed");
  const statusLabel = document.querySelector("#status");
  const statusDot = document.querySelector("#status-dot");
  const soundToggle = document.querySelector("#sound-toggle");
  const volumeSlider = document.querySelector("#volume");
  const riverMessage = document.querySelector("#river-message");
  const width = canvas.width;
  const height = canvas.height;
  const keys = new Set();
  const heldControls = new Set();
  const boatY = height * 0.69;
  const boatWidth = 38;
  const treeModels = [
    { name: "figueira", shape: "broad", clusters: 12 },
    { name: "farinha-seca", shape: "oval", clusters: 9 },
    { name: "coqueiro", shape: "palm" },
    { name: "bambu-grande", shape: "bamboo" },
    { name: "jatoba", shape: "round", clusters: 8 },
    { name: "ingazeiro", shape: "wide", clusters: 10 },
    { name: "ipe", shape: "round", clusters: 8, flowers: true },
    { name: "palmeira", shape: "palm", broadFronds: true },
    { name: "aroeira", shape: "tall", clusters: 7 },
    { name: "bambu-gigante", shape: "bamboo", dense: true }
  ];

  let state = "ready";
  let boatX = width / 2;
  let scrollY = 0;
  let speed = 0;
  let distance = 0;
  let lastTime = 0;
  let messageTimer = 0;
  let impactCooldown = 0;
  let lastStatus = "";
  let obstacles = [];

  const audio = createSoundscape();

  function riverCenter(worldY) {
    return width / 2
      + Math.sin(worldY / 410) * 120
      + Math.sin(worldY / 175 + 0.8) * 32
      + Math.sin(worldY / 1030 + 1.6) * 27;
  }

  function riverHalfWidth(worldY) {
    const bend = Math.sin(worldY / 590 + 0.7) * 16 + Math.sin(worldY / 235) * 8;
    const narrowPhase = ((worldY % 3380) + 3380) % 3380;
    const narrow = narrowPhase > 2050 && narrowPhase < 2500 ? 78 : 0;
    return 288 + bend - narrow;
  }

  function seededNoise(value) {
    const number = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return number - Math.floor(number);
  }

  function obstacleAt(index) {
    const worldY = index * 390 + 620 + seededNoise(index * 2.41 + 5) * 140;
    const halfWidth = riverHalfWidth(worldY);
    const offset = (seededNoise(worldY * 0.23) * 2 - 1) * (halfWidth - 48);
    const type = seededNoise(worldY * 0.41) > 0.55 ? "branch" : "rock";
    return {
      y: worldY,
      x: riverCenter(worldY) + offset,
      type,
      radius: type === "rock" ? 15 + seededNoise(worldY) * 9 : 17 + seededNoise(worldY * 0.7) * 8
    };
  }

  function updateObstacles() {
    const firstIndex = Math.floor((scrollY - 160 - 760) / 390);
    const lastIndex = Math.ceil((scrollY + height + 160 - 620) / 390);
    obstacles = [];
    for (let index = firstIndex; index <= lastIndex; index++) {
      const obstacle = obstacleAt(index);
      if (obstacle.y >= scrollY - 160 && obstacle.y <= scrollY + height + 160) {
        obstacles.push(obstacle);
      }
    }
  }

  function resetGame() {
    boatX = width / 2;
    scrollY = 0;
    speed = 0;
    distance = 0;
    impactCooldown = 0;
    updateObstacles();
    updateHud();
  }

  function updateHud() {
    distanceLabel.textContent = `${Math.floor(distance).toLocaleString("pt-BR")} m`;
    const speedInKmh = Math.round(Math.abs(speed) * 0.12);
    speedLabel.textContent = speed < 0 ? `Ré ${speedInKmh} km/h` : `${speedInKmh} km/h`;
    const narrowPhase = ((scrollY + boatY) % 3380 + 3380) % 3380;
    const status = narrowPhase > 1870 && narrowPhase < 2580 ? "Passagem estreita" : "Rio Mogi";
    statusLabel.textContent = status === "Passagem estreita" ? "Passagem estreita" : "Rio Mogi";
    statusDot.classList.toggle("narrow", status === "Passagem estreita");
    if (status !== lastStatus && state === "playing" && status === "Passagem estreita") {
      showMessage("Passagem estreita — atenção às pedras!");
    }
    lastStatus = status;
  }

  function showMessage(text) {
    riverMessage.textContent = text;
    riverMessage.classList.add("visible");
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => riverMessage.classList.remove("visible"), 1900);
  }

  function beginGame() {
    if (state === "paused") {
      state = "playing";
      overlay.hidden = true;
      lastTime = performance.now();
      updateHud();
      audio.play();
      return;
    }
    resetGame();
    state = "playing";
    overlay.hidden = true;
    lastTime = performance.now();
    updateHud();
    audio.play();
    showMessage("Passeio iniciado. Bom rio!");
  }

  function pauseGame() {
    if (state !== "playing" && state !== "paused") return;
    if (state === "playing") {
      state = "paused";
      overlayTitle.innerHTML = "Um respiro<br>à beira do rio.";
      overlayCopy.textContent = "O barco está em segurança. Quando quiser, é só voltar para o leme.";
      buttonLabel.textContent = "CONTINUAR PASSEIO";
      overlay.hidden = false;
      audio.pause();
      updateHud();
    } else {
      beginGame();
    }
  }

  function update(delta) {
    const turnLeft = keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || heldControls.has("left");
    const turnRight = keys.has("ArrowRight") || keys.has("d") || keys.has("D") || heldControls.has("right");
    const accelerate = keys.has("ArrowUp") || keys.has("w") || keys.has("W") || heldControls.has("faster");
    const slowDown = keys.has("ArrowDown") || keys.has("s") || keys.has("S") || heldControls.has("slower");

    if (accelerate !== slowDown) {
      speed = Math.max(-100, Math.min(185, speed + (accelerate ? 48 : -48) * delta));
    }

    const steering = ((turnRight ? 1 : 0) - (turnLeft ? 1 : 0)) * Math.sign(speed);
    boatX += steering * (230 + Math.abs(speed) * 0.22) * delta;
    scrollY += speed * delta;
    distance += Math.abs(speed) * delta * 0.12;
    impactCooldown = Math.max(0, impactCooldown - delta);

    const worldBoatY = scrollY + boatY;
    updateObstacles();

    const edge = riverHalfWidth(worldBoatY);
    const center = riverCenter(worldBoatY);
    if (boatX < center - edge + 25 || boatX > center + edge - 25) {
      boatX += (center - boatX) * Math.min(1, delta * 1.9);
      speed *= Math.max(0, 1 - 1.2 * delta);
      if (impactCooldown === 0) {
        impactCooldown = 1.15;
        showMessage("Margem próxima — reduza e ajuste o rumo.");
      }
    }

    for (const obstacle of obstacles) {
      if (Math.abs(obstacle.y - worldBoatY) < obstacle.radius + 24
          && Math.abs(obstacle.x - boatX) < obstacle.radius + boatWidth * 0.43
          && impactCooldown === 0) {
        impactCooldown = 1.15;
        speed *= 0.45;
        boatX += boatX < obstacle.x ? -21 : 21;
        showMessage("Opa! Desvie da pedra ou do galho.");
        break;
      }
    }

    audio.setThrottle(Math.abs(speed) / 185);
    updateHud();
  }

  function applyThrottleStep(key) {
    if (state !== "playing") return;
    const forward = key === "ArrowUp" || key === "w" || key === "W";
    const reverse = key === "ArrowDown" || key === "s" || key === "S";
    if (forward) speed = Math.min(185, speed + 8);
    else if (reverse) speed = Math.max(-100, speed - 8);
    updateHud();
  }

  function drawBank() {
    ctx.fillStyle = "#183c2d";
    ctx.fillRect(0, 0, width, height);

    for (let y = -18; y < height + 36; y += 11) {
      const worldY = scrollY + y;
      const center = riverCenter(worldY);
      const edge = riverHalfWidth(worldY);
      if (y === -18) {
        ctx.beginPath();
        ctx.moveTo(center - edge, y);
      } else {
        ctx.lineTo(center - edge, y);
      }
    }
    for (let y = height + 36; y >= -18; y -= 11) {
      const worldY = scrollY + y;
      ctx.lineTo(riverCenter(worldY) + riverHalfWidth(worldY), y);
    }
    ctx.closePath();
    ctx.fillStyle = "#234b36";
    ctx.fill();

    for (let y = -65; y < height + 75; y += 32) {
      const worldY = scrollY + y;
      const center = riverCenter(worldY);
      const edge = riverHalfWidth(worldY);
      for (const side of [-1, 1]) {
        const row = Math.floor(worldY / 32);
        for (let band = 0; band < 5; band++) {
          const seed = row * 19 + side * 7 + band * 31 + 80;
          const variation = seededNoise(seed);
          const bankDepth = 20 + band * 43 + seededNoise(seed + 4) * 20;
          const x = center + side * (edge + bankDepth);
          const species = Math.floor(seededNoise(seed + 11) * treeModels.length);
          const size = 18 + seededNoise(seed + 17) * 18;
          drawTree(x, y + (seededNoise(seed + 2) - 0.5) * 25, size, species, seed, variation);
        }
      }
    }
  }

  function drawTree(x, y, radius, species, seed, variation) {
    if (x < -radius * 2 || x > width + radius * 2) return;
    const model = treeModels[species];
    const palette = variation > 0.78
      ? ["#183c2d", "#24583a", "#347347", "#5f8a4b"]
      : variation > 0.48
        ? ["#14392b", "#20563a", "#307044", "#4b7f43"]
        : ["#123528", "#1d4d35", "#2a663e", "#477943"];
    const rotation = seededNoise(seed + 29) * Math.PI * 2;
    const lobes = 8 + Math.floor(seededNoise(seed + 23) * 5);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = "#0c281f99";
    ctx.beginPath();
    ctx.ellipse(3, radius * 0.23, radius * 1.15, radius * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();

    if (model.shape === "palm") {
      drawPalmCrown(radius, palette, seed, model.broadFronds);
    } else if (model.shape === "bamboo") {
      drawBambooCrown(radius, palette, seed, model.dense);
    } else {
      const stretchX = model.shape === "wide" ? 1.3 : model.shape === "tall" ? 0.82 : model.shape === "oval" ? 1.12 : 1;
      const stretchY = model.shape === "wide" ? 0.82 : model.shape === "tall" ? 1.22 : model.shape === "oval" ? 0.92 : 1;
      drawLobedCanopy(radius, lobes, palette[0], seed, stretchX, stretchY);
      ctx.fillStyle = palette[1];
      ctx.beginPath();
      ctx.ellipse(-radius * 0.08, -radius * 0.08, radius * stretchX * 0.75, radius * stretchY * 0.68, 0, 0, Math.PI * 2);
      ctx.fill();

      const clusterCount = model.clusters;
      for (let i = 0; i < clusterCount; i++) {
        const angle = (i / clusterCount) * Math.PI * 2 + seededNoise(seed + i * 3) * 0.7;
        const reach = radius * (0.18 + seededNoise(seed + i * 5 + 1) * 0.55);
        const clusterRadius = radius * (0.2 + seededNoise(seed + i * 7 + 2) * 0.22);
        const cx = Math.cos(angle) * reach * stretchX;
        const cy = Math.sin(angle) * reach * stretchY;
        const color = palette[1 + Math.floor(seededNoise(seed + i * 11 + 3) * 3)];
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(cx, cy, clusterRadius * (model.shape === "oval" ? 1.2 : 1), clusterRadius * (model.shape === "oval" ? 0.75 : 0.9), angle * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      drawLeafHighlights(radius, palette[3], seed, model.flowers ? 22 : model.name === "figueira" ? 24 : 16, model.flowers);
    }
    ctx.restore();
  }

  function drawLobedCanopy(radius, lobes, color, seed, stretchX, stretchY) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.86 * stretchX, radius * 0.82 * stretchY, 0, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < lobes; i++) {
      const angle = (i / lobes) * Math.PI * 2;
      const lobeRadius = radius * (0.34 + seededNoise(seed + i * 19 + 6) * 0.13);
      const lx = Math.cos(angle) * radius * 0.64 * stretchX;
      const ly = Math.sin(angle) * radius * 0.64 * stretchY;
      ctx.beginPath();
      ctx.ellipse(lx, ly, lobeRadius * stretchX, lobeRadius * stretchY, angle, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPalmCrown(radius, palette, seed, broadFronds) {
    const frondCount = broadFronds ? 11 : 9;
    ctx.lineCap = "round";
    for (let i = 0; i < frondCount; i++) {
      const angle = (i / frondCount) * Math.PI * 2;
      const length = radius * (0.78 + seededNoise(seed + i * 7) * 0.56);
      const bend = (seededNoise(seed + i * 11) - 0.5) * radius * 0.38;
      const endX = Math.cos(angle) * length;
      const endY = Math.sin(angle) * length;
      ctx.strokeStyle = palette[i % 3 + 1];
      ctx.lineWidth = broadFronds ? 3.2 : 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(angle + 0.45) * length * 0.52 + bend, Math.sin(angle + 0.45) * length * 0.52, endX, endY);
      ctx.stroke();
      for (const side of [-1, 1]) {
        for (let leaf = 1; leaf <= 5; leaf++) {
          const t = leaf / 6;
          const along = length * t;
          const leafLength = radius * (0.19 + Math.sin(t * Math.PI) * 0.16);
          const baseX = Math.cos(angle) * along;
          const baseY = Math.sin(angle) * along;
          const leafAngle = angle + side * (0.75 + t * 0.48);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(baseX, baseY);
          ctx.lineTo(baseX + Math.cos(leafAngle) * leafLength, baseY + Math.sin(leafAngle) * leafLength);
          ctx.stroke();
        }
      }
    }
    ctx.fillStyle = palette[3];
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette[0];
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBambooCrown(radius, palette, seed, dense) {
    const clumps = dense ? 7 : 5;
    for (let i = 0; i < clumps; i++) {
      const angle = (i / clumps) * Math.PI * 2 + seededNoise(seed + i) * 0.45;
      const reach = radius * (0.25 + seededNoise(seed + i * 5) * 0.38);
      const cx = Math.cos(angle) * reach;
      const cy = Math.sin(angle) * reach;
      const fronds = 5 + Math.floor(seededNoise(seed + i * 9) * 4);
      ctx.fillStyle = palette[i % 3 + 1];
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (0.24 + seededNoise(seed + i * 3) * 0.1), 0, Math.PI * 2);
      ctx.fill();
      for (let leaf = 0; leaf < fronds; leaf++) {
        const leafAngle = angle + (leaf / fronds) * Math.PI * 2;
        const length = radius * (0.32 + seededNoise(seed + i * 17 + leaf) * 0.35);
        ctx.strokeStyle = palette[1 + ((leaf + i) % 3)];
        ctx.lineWidth = 1.5 + (dense ? 0.5 : 0);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + Math.cos(leafAngle + 0.3) * length * 0.55, cy + Math.sin(leafAngle + 0.3) * length * 0.55, cx + Math.cos(leafAngle) * length, cy + Math.sin(leafAngle) * length);
        ctx.stroke();
      }
    }
  }

  function drawLeafHighlights(radius, color, seed, count, flowers) {
    for (let i = 0; i < count; i++) {
      const angle = seededNoise(seed + i * 17 + 91) * Math.PI * 2;
      const reach = radius * Math.sqrt(seededNoise(seed + i * 19 + 37)) * 0.86;
      const x = Math.cos(angle) * reach;
      const y = Math.sin(angle) * reach;
      ctx.fillStyle = flowers && i % 3 === 0 ? "#b7c96d" : color;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 0.055, radius * (flowers ? 0.045 : 0.07), angle, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWater() {
    const top = scrollY;
    ctx.beginPath();
    for (let y = -8; y <= height + 8; y += 8) {
      const center = riverCenter(top + y);
      const edge = riverHalfWidth(top + y);
      if (y === -8) ctx.moveTo(center - edge, y);
      else ctx.lineTo(center - edge, y);
    }
    for (let y = height + 8; y >= -8; y -= 8) {
      ctx.lineTo(riverCenter(top + y) + riverHalfWidth(top + y), y);
    }
    ctx.closePath();
    const water = ctx.createLinearGradient(0, 0, width, height);
    water.addColorStop(0, "#366e68");
    water.addColorStop(0.48, "#2d6865");
    water.addColorStop(1, "#285b5b");
    ctx.fillStyle = water;
    ctx.fill();

    ctx.save();
    ctx.clip();
    for (let y = -15; y < height + 24; y += 23) {
      const worldY = scrollY + y;
      for (let i = 0; i < 8; i++) {
        const noise = seededNoise(Math.floor(worldY / 23) * 15 + i);
        const x = riverCenter(worldY) + (noise * 2 - 1) * riverHalfWidth(worldY) * 0.82;
        const drift = ((scrollY * 0.23 + i * 13) % 20);
        ctx.strokeStyle = `rgba(194, 217, 181, ${0.07 + noise * 0.13})`;
        ctx.lineWidth = 1 + noise * 1.3;
        ctx.beginPath();
        ctx.moveTo(x, y + drift);
        ctx.quadraticCurveTo(x + 8, y + drift - 1, x + 17, y + drift + 1);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#a4b58a";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let y = -8; y <= height + 8; y += 9) {
        const shore = riverCenter(scrollY + y) + side * riverHalfWidth(scrollY + y);
        if (y === -8) ctx.moveTo(shore, y);
        else ctx.lineTo(shore, y);
      }
      ctx.stroke();
    }
  }

  function drawBeaches() {
    for (let y = -10; y < height + 20; y += 6) {
      const worldY = scrollY + y;
      const center = riverCenter(worldY);
      const edge = riverHalfWidth(worldY);
      const patchPhase = ((worldY % 1800) + 1800) % 1800;
      if (patchPhase > 700 && patchPhase < 880) {
        const side = Math.floor(worldY / 1800) % 2 === 0 ? -1 : 1;
        const t = (patchPhase - 700) / 180;
        const beachLength = Math.sin(t * Math.PI) * 58;
        const shore = center + side * (edge - 3);
        ctx.fillStyle = "#c5b98b";
        ctx.beginPath();
        ctx.moveTo(shore, y - beachLength * 0.38);
        ctx.quadraticCurveTo(shore + side * beachLength * 0.7, y, shore, y + beachLength * 0.38);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawObstacle(obstacle) {
    const screenY = obstacle.y - scrollY;
    if (screenY < -35 || screenY > height + 35) return;
    const x = obstacle.x;
    if (obstacle.type === "rock") {
      ctx.fillStyle = "#1c3c3c77";
      ctx.beginPath();
      ctx.ellipse(x + 3, screenY + 5, obstacle.radius * 1.25, obstacle.radius * 0.76, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#777c70";
      ctx.beginPath();
      ctx.ellipse(x, screenY, obstacle.radius, obstacle.radius * 0.7, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#a4a38a";
      ctx.beginPath();
      ctx.ellipse(x - obstacle.radius * 0.2, screenY - obstacle.radius * 0.16, obstacle.radius * 0.44, obstacle.radius * 0.22, -0.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineCap = "round";
      ctx.strokeStyle = "#735a3d";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(x - obstacle.radius, screenY - 4);
      ctx.lineTo(x + obstacle.radius, screenY + 4);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#98794d";
      ctx.beginPath();
      ctx.moveTo(x - 4, screenY);
      ctx.lineTo(x + 2, screenY - 12);
      ctx.stroke();
    }
  }

  function drawBoat() {
    ctx.save();
    ctx.translate(boatX, boatY);
    ctx.fillStyle = "#10251f66";
    ctx.beginPath();
    ctx.ellipse(4, 6, 25, 37, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#bdc5b0";
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.quadraticCurveTo(20, -20, 19, 11);
    ctx.lineTo(11, 28);
    ctx.lineTo(-11, 28);
    ctx.lineTo(-19, 11);
    ctx.quadraticCurveTo(-20, -20, 0, -34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#54675a";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#536b5a";
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(13, -10);
    ctx.lineTo(11, 13);
    ctx.lineTo(-11, 13);
    ctx.lineTo(-13, -10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#b9965e";
    ctx.fillRect(-10, 13, 20, 4);
    ctx.fillStyle = "#d4a25f";
    ctx.fillRect(-4, 26, 8, 13);
    ctx.fillStyle = "#283b30";
    ctx.fillRect(-1, 31, 2, 15);
    ctx.strokeStyle = "#d2ded050";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -27);
    ctx.lineTo(0, -12);
    ctx.stroke();
    ctx.restore();
  }

  function drawScene() {
    drawBank();
    drawWater();
    drawBeaches();
    obstacles.forEach(drawObstacle);
    drawBoat();
  }

  function frame(time) {
    const delta = Math.min((time - lastTime) / 1000 || 0, 0.05);
    lastTime = time;
    if (state === "playing") update(delta);
    drawScene();
    requestAnimationFrame(frame);
  }

  function createSoundscape() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    let context;
    let master;
    let ambienceGain;
    let engineGain;
    let birdTimer;
    let enabled = true;

    function noiseSource(filterFrequency, level) {
      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = filterFrequency;
      gain.gain.value = level;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ambienceGain);
      source.start();
    }

    function chirp() {
      if (!context || context.state !== "running" || state !== "playing") return;
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const pitch = 1700 + Math.random() * 1500;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(pitch, now);
      oscillator.frequency.exponentialRampToValueAtTime(pitch * (0.7 + Math.random() * 0.5), now + 0.12);
      envelope.gain.setValueAtTime(0.001, now);
      envelope.gain.exponentialRampToValueAtTime(0.045, now + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      oscillator.connect(envelope);
      envelope.connect(ambienceGain);
      oscillator.start(now);
      oscillator.stop(now + 0.16);
    }

    function initialize() {
      if (!AudioContextClass) {
        soundToggle.disabled = true;
        soundToggle.textContent = "ÁUDIO INDISPONÍVEL";
        return false;
      }
      if (context) return true;
      try {
        context = new AudioContextClass();
        master = context.createGain();
        ambienceGain = context.createGain();
        engineGain = context.createGain();
        master.gain.value = enabled ? 0.55 : 0;
        ambienceGain.gain.value = 0.45;
        engineGain.gain.value = 0;
        ambienceGain.connect(master);
        engineGain.connect(master);
        master.connect(context.destination);
        noiseSource(850, 0.26);
        noiseSource(210, 0.11);

        for (const [frequency, level] of [[58, 0.16], [87, 0.045]]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sawtooth";
          oscillator.frequency.value = frequency;
          gain.gain.value = level;
          oscillator.connect(gain);
          gain.connect(engineGain);
          oscillator.start();
        }
      } catch (error) {
        console.error("Não foi possível iniciar os sons do passeio.", error);
        soundToggle.disabled = true;
        soundToggle.textContent = "ERRO NO ÁUDIO";
        return false;
      }
      return true;
    }

    function play() {
      if (!initialize()) return;
      if (context.state === "suspended") {
        context.resume().catch(error => console.error("Não foi possível liberar os sons do passeio.", error));
      }
      if (!enabled) return;
      master.gain.setTargetAtTime(Number(volumeSlider.value) / 100 * 0.75, context.currentTime, 0.08);
      ambienceGain.gain.setTargetAtTime(0.45, context.currentTime, 0.1);
      if (birdTimer === undefined) birdTimer = window.setInterval(chirp, 1050 + Math.random() * 700);
    }

    function pause() {
      if (!context) return;
      ambienceGain.gain.setTargetAtTime(0, context.currentTime, 0.12);
      engineGain.gain.setTargetAtTime(0, context.currentTime, 0.08);
      window.clearInterval(birdTimer);
      birdTimer = undefined;
    }

    function setThrottle(amount) {
      if (context && state === "playing" && enabled) {
        engineGain.gain.setTargetAtTime(0.05 + amount * 0.23, context.currentTime, 0.12);
      }
    }

    function toggle() {
      enabled = !enabled;
      soundToggle.setAttribute("aria-pressed", String(enabled));
      soundToggle.innerHTML = enabled
        ? '<span aria-hidden="true">◖))</span> SOM LIGADO'
        : '<span aria-hidden="true">◖×</span> SOM DESLIGADO';
      if (!initialize()) return;
      master.gain.setTargetAtTime(enabled ? Number(volumeSlider.value) / 100 * 0.75 : 0, context.currentTime, 0.06);
      if (enabled && state === "playing") play();
      else if (!enabled) pause();
    }

    volumeSlider.addEventListener("input", () => {
      if (context && enabled) {
        master.gain.setTargetAtTime(Number(volumeSlider.value) / 100 * 0.75, context.currentTime, 0.04);
      }
    });
    soundToggle.addEventListener("click", toggle);

    return { play, pause, setThrottle };
  }

  startButton.addEventListener("click", beginGame);
  window.addEventListener("keydown", event => {
    const focusedControl = event.target instanceof HTMLElement && event.target.closest("input, select, textarea");
    if (!focusedControl && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) {
      event.preventDefault();
    }
    if (focusedControl) return;
    if (!event.repeat) applyThrottleStep(event.key);
    keys.add(event.key);
    if ((event.key === "p" || event.key === "P" || event.key === " ") && !event.repeat) pauseGame();
    if ((event.key === "Enter" || event.key === " ") && state === "ready") beginGame();
  });
  window.addEventListener("keyup", event => keys.delete(event.key));
  window.addEventListener("blur", () => {
    keys.clear();
    heldControls.clear();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") pauseGame();
  });

  document.querySelectorAll("[data-control]").forEach(button => {
    const control = button.dataset.control;
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      heldControls.add(control);
      if (control === "faster") applyThrottleStep("ArrowUp");
      if (control === "slower") applyThrottleStep("ArrowDown");
      button.setPointerCapture(event.pointerId);
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(eventName, () => heldControls.delete(control));
    }
  });

  resetGame();
  requestAnimationFrame(frame);
})();
