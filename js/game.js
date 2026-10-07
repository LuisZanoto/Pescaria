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
  const fuelLabel = document.querySelector("#fuel");
  const motorSummary = document.querySelector("#motor-summary");
  const motorReadout = document.querySelector("#motor-readout");
  const statusLabel = document.querySelector("#status");
  const statusDot = document.querySelector("#status-dot");
  const mapProgressLabel = document.querySelector("#map-progress");
  const upstreamRoute = document.querySelector("#upstream-course");
  const downstreamRoute = document.querySelector("#downstream-course");
  const mapBoat = document.querySelector("#map-boat");
  const soundToggle = document.querySelector("#sound-toggle");
  const volumeSlider = document.querySelector("#volume");
  const riverMessage = document.querySelector("#river-message");
  const width = canvas.width;
  const height = canvas.height;
  const keys = new Set();
  const heldControls = new Set();
  const boatY = height * 0.69;
  const sceneMapScale = 1.8;
  const scenePixelsPerMeter = 1.5;
  const boatScale = 0.06;
  const boatLengthMeters = 6;
  const boatWidthMeters = 1.2;
  const boatWidth = boatWidthMeters * scenePixelsPerMeter;
  const routeLength = 18000;
  const startStation = routeLength / 2;
  // Keep this specification aligned with motor.txt, which cannot be fetched as data from file:// pages.
  const motor = Object.freeze({
    type: "2 tempos",
    powerHp: 5,
    speedLevels: 5,
    minimumRpm: 800,
    maximumRpm: 9000,
    noiseLevelsDb: [65, 75, 85, 95, 105],
    maximumEngineAudioGain: 0.012,
    upstreamMaxSpeedKmh: 18,
    downstreamMaxSpeedKmh: 27,
    upstreamLitersPerLeg: 8,
    downstreamLitersPerLeg: 4,
    legLengthMeters: 9000,
    tankCapacityLiters: 10,
    startingFuelLiters: 3
  });
  const powerScale = motor.powerHp / 5;
  const maxForwardSpeed = motor.downstreamMaxSpeedKmh * powerScale;
  const maxReverseSpeed = motor.upstreamMaxSpeedKmh * powerScale;
  const acceleration = 6 * powerScale;
  const throttleStep = 3 * powerScale;
  const capsizeSpeed = 10 * powerScale;
  const fuelCapacity = motor.tankCapacityLiters;
  const obstacleSpacingMeters = 450;
  const upstreamRouteLength = upstreamRoute.getTotalLength();
  const downstreamRouteLength = downstreamRoute.getTotalLength();
  const routeSampleStep = 10;
  const routeSamples = Array.from({ length: routeLength / routeSampleStep + 1 }, (_, index) => (
    routePointFromMap(index * routeSampleStep)
  ));
  let sceneCamera = null;
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
  let boatX = 0;
  let speed = 0;
  let boatHeading = 0;
  let distance = 0;
  let fuel = motor.startingFuelLiters;
  let lastTime = 0;
  let messageTimer = 0;
  let impactCooldown = 0;
  let turnRisk = 0;
  let turnWarningShown = false;
  let capsized = false;
  let obstacles = [];

  const audio = createSoundscape();

  function routePointFromMap(station) {
    const boundedStation = Math.max(0, Math.min(routeLength, station));
    if (boundedStation <= startStation) {
      const progress = boundedStation / startStation;
      return upstreamRoute.getPointAtLength(upstreamRouteLength * progress);
    }
    const progress = (boundedStation - startStation) / startStation;
    return downstreamRoute.getPointAtLength(downstreamRouteLength * progress);
  }

  function routePointAtStation(station) {
    const boundedStation = Math.max(0, Math.min(routeLength, station));
    const position = boundedStation / routeSampleStep;
    const index = Math.floor(position);
    const fraction = position - index;
    const point = routeSamples[index];
    const next = routeSamples[Math.min(index + 1, routeSamples.length - 1)];
    return {
      x: point.x + (next.x - point.x) * fraction,
      y: point.y + (next.y - point.y) * fraction
    };
  }

  function routeTangentAtStation(station) {
    const offset = routeSampleStep;
    const before = station < startStation
      ? routePointAtStation(Math.max(0, station - offset))
      : routePointAtStation(station);
    const after = station < startStation
      ? routePointAtStation(station)
      : routePointAtStation(Math.min(routeLength, station + offset));
    const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    return { x: (after.x - before.x) / length, y: (after.y - before.y) / length };
  }

  function scenePointAtStation(station, lateralOffset = 0) {
    const point = routePointAtStation(station);
    const tangent = routeTangentAtStation(station);
    const cameraPoint = sceneCamera ? sceneCamera.point : routePointAtStation(startStation + distance);
    const normalX = tangent.y;
    const normalY = -tangent.x;
    return {
      x: width / 2 + (point.x - cameraPoint.x) * sceneMapScale + normalX * lateralOffset,
      y: boatY + (point.y - cameraPoint.y) * sceneMapScale + normalY * lateralOffset,
      tangentX: tangent.x,
      tangentY: tangent.y,
      rightX: normalX,
      rightY: normalY
    };
  }

  function riverHalfWidth(station) {
    const widthMeters = 60 + 30 * Math.sin(station / 1800 + 0.7);
    return widthMeters * scenePixelsPerMeter / 2;
  }

  function seededNoise(value) {
    const number = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return number - Math.floor(number);
  }

  function obstacleAt(index) {
    const station = index * obstacleSpacingMeters + 108 + seededNoise(index * 2.41 + 5) * 108;
    const halfWidth = riverHalfWidth(station);
    const lateralOffset = (seededNoise(station * 0.23) * 2 - 1) * Math.max(0, halfWidth - 18);
    const type = seededNoise(station * 0.41) > 0.55 ? "branch" : "rock";
    return {
      station,
      lateralOffset,
      type,
      radius: (type === "rock" ? 1.5 : 1.8) * scenePixelsPerMeter
    };
  }

  function updateObstacles() {
    const station = startStation + distance;
    const firstIndex = Math.floor((station - 1900) / obstacleSpacingMeters);
    const lastIndex = Math.ceil((station + 1900) / obstacleSpacingMeters);
    obstacles = [];
    for (let index = firstIndex; index <= lastIndex; index++) {
      const obstacle = obstacleAt(index);
      if (obstacle.station >= 0 && obstacle.station <= routeLength) {
        obstacles.push(obstacle);
      }
    }
  }

  function resetGame() {
    boatX = 0;
    distance = 0;
    speed = 0;
    boatHeading = 0;
    fuel = motor.startingFuelLiters;
    impactCooldown = 0;
    turnRisk = 0;
    turnWarningShown = false;
    capsized = false;
    overlayTitle.innerHTML = "A correnteza<br>está chamando.";
    overlayCopy.textContent = `O início fica no meio do trajeto. Desça o rio para chegar ao ponto 2; use a ré para subir até o ponto 1. Cada trecho tem 9 km: na velocidade máxima, são 18 km/h rio acima (30 min) e 27 km/h rio abaixo (20 min). A canoa mede 6 m de comprimento por 1,2 m de largura e leva quatro pescadores: um pilota no motor de popa ${motor.powerHp} HP (${motor.type}) e os outros três ocupam os demais bancos. O tanque comporta ${fuelCapacity} L e começa com ${motor.startingFuelLiters} L.`;
    buttonLabel.textContent = "COMEÇAR O PASSEIO";
    updateObstacles();
    updateHud();
  }

  function updateHud() {
    const station = startStation + distance;
    const stationKm = (station / 1000).toFixed(1).replace(".", ",");
    distanceLabel.textContent = `km ${stationKm}`;
    const mapDirection = station === startStation ? "INÍCIO"
      : station < startStation ? "RIO ACIMA" : "RIO ABAIXO";
    mapProgressLabel.textContent = `${stationKm} KM · ${mapDirection}`;
    const speedInKmh = Math.round(Math.abs(speed));
    speedLabel.textContent = speed < 0 ? `Ré ${speedInKmh} km/h` : `${speedInKmh} km/h`;
    fuelLabel.textContent = `${fuel.toFixed(2).replace(".", ",")} / ${fuelCapacity} L`;
    fuelLabel.classList.toggle("low-fuel", fuel <= fuelCapacity * 0.2);
    const engine = getEngineTelemetry();
    motorSummary.textContent = `${motor.powerHp} HP · ${motor.type === "2 tempos" ? "2T" : motor.type}`;
    motorReadout.textContent = engine.rpm === 0
      ? "MOTOR DESLIGADO"
      : `NÍVEL ${engine.level} · ${engine.rpm} RPM · ${engine.noiseDb} dB`;
    const status = station <= 0 ? "Ponto 1"
      : station >= routeLength ? "Ponto 2"
        : Math.abs(station - startStation) < 1 ? "Início do trajeto"
          : station < startStation ? "Rio acima" : "Rio abaixo";
    statusLabel.textContent = status;
    statusDot.classList.toggle("narrow", status === "Ponto 1" || status === "Ponto 2");
    updateRouteMap();
  }

  function getEngineTelemetry() {
    if (fuel <= 0) return { rpm: 0, level: 0, noiseDb: 0 };
    const speedLimit = speed < 0 ? maxReverseSpeed : maxForwardSpeed;
    const speedRatio = Math.min(1, Math.abs(speed) / speedLimit);
    const rpm = Math.round(motor.minimumRpm + speedRatio * (motor.maximumRpm - motor.minimumRpm));
    const level = Math.min(motor.speedLevels, Math.max(1, Math.ceil(speedRatio * motor.speedLevels)));
    return { rpm, level, noiseDb: motor.noiseLevelsDb[level - 1] };
  }

  function updateRouteMap() {
    if (!mapBoat) return;
    const station = Math.max(0, Math.min(routeLength, startStation + distance));
    const location = routePointAtStation(station);
    mapBoat.setAttribute("transform", `translate(${location.x} ${location.y})`);
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
      audio.setEngineState(getEngineTelemetry());
      return;
    }
    resetGame();
    state = "playing";
    overlay.hidden = true;
    lastTime = performance.now();
    updateHud();
    audio.play();
    audio.setEngineState(getEngineTelemetry());
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

  function endGame() {
    state = "gameover";
    capsized = true;
    keys.clear();
    heldControls.clear();
    overlayTitle.innerHTML = "A canoa virou<br>na curva.";
    overlayCopy.textContent = "Curvas fechadas em alta velocidade podem virar a canoa. Reduza antes de manobrar e tente novamente.";
    buttonLabel.textContent = "TENTAR NOVAMENTE";
    overlay.hidden = false;
    audio.pause();
    updateHud();
  }

  function update(delta) {
    const turnLeft = keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || heldControls.has("left");
    const turnRight = keys.has("ArrowRight") || keys.has("d") || keys.has("D") || heldControls.has("right");
    const accelerate = keys.has("ArrowUp") || keys.has("w") || keys.has("W") || heldControls.has("faster");
    const slowDown = keys.has("ArrowDown") || keys.has("s") || keys.has("S") || heldControls.has("slower");
    const turnInput = (turnRight ? 1 : 0) - (turnLeft ? 1 : 0);

    if (fuel > 0 && accelerate !== slowDown) {
      speed = Math.max(-maxReverseSpeed, Math.min(maxForwardSpeed, speed + (accelerate ? acceleration : -acceleration) * delta));
    } else if (fuel <= 0) {
      speed = 0;
    }

    const steering = turnInput * Math.sign(speed);
    const turnRate = steering * (0.85 + Math.abs(speed) / maxForwardSpeed * 0.55);
    boatHeading = Math.max(-0.65, Math.min(0.65, boatHeading + turnRate * delta));
    if (!turnInput) boatHeading *= Math.max(0, 1 - delta * 1.8);
    boatX += steering * Math.abs(speed) * 0.35 * delta;
    const previousDistance = distance;
    const previousStation = startStation + previousDistance;
    const stepMeters = speed * delta / 3.6;
    const travelDirection = Math.sign(stepMeters);
    let nextStation = previousStation + stepMeters;
    if (nextStation < 0 || nextStation > routeLength) {
      const upstreamLimit = nextStation < 0;
      nextStation = upstreamLimit ? 0 : routeLength;
      distance = nextStation - startStation;
      speed = 0;
      if (impactCooldown === 0) {
        impactCooldown = 1;
        showMessage(upstreamLimit
          ? "Ponto 1: limite rio acima. A partir daqui, só se desce."
          : "Ponto 2: limite rio abaixo. Para voltar, suba o rio em ré.");
      }
    } else {
      distance = nextStation - startStation;
    }
    const traveledMeters = Math.abs(nextStation - previousStation);
    if (traveledMeters > 0) {
      const consumptionPerMeter = travelDirection < 0
        ? motor.upstreamLitersPerLeg / motor.legLengthMeters
        : motor.downstreamLitersPerLeg / motor.legLengthMeters;
      fuel = Math.max(0, fuel - traveledMeters * consumptionPerMeter);
      if (fuel === 0) {
        speed = 0;
        showMessage("Sem gasolina. A canoa parou.");
      }
    }
    if (previousStation < startStation && nextStation >= startStation) {
      showMessage("Início do trajeto — agora rio abaixo, rumo ao ponto 2.");
    } else if (previousStation > startStation && nextStation <= startStation) {
      showMessage("Início do trajeto — agora rio acima, rumo ao ponto 1.");
    }
    impactCooldown = Math.max(0, impactCooldown - delta);

    if (Math.abs(speed) >= capsizeSpeed && Math.abs(turnRate) >= 1.1) {
      turnRisk += delta;
      if (turnRisk >= 0.2 && !turnWarningShown) {
        turnWarningShown = true;
        showMessage("Curva fechada em alta velocidade! Reduza agora.");
      }
      if (turnRisk >= 0.55) {
        endGame();
        return;
      }
    } else {
      turnRisk = Math.max(0, turnRisk - delta * 1.8);
      if (turnRisk === 0) turnWarningShown = false;
    }

    updateObstacles();

    const edge = riverHalfWidth(nextStation);
    const maximumLateralOffset = Math.max(0, edge - boatWidth / 2);
    if (Math.abs(boatX) > maximumLateralOffset) {
      boatX = Math.sign(boatX) * maximumLateralOffset;
      speed *= Math.max(0, 1 - 1.2 * delta);
      if (impactCooldown === 0) {
        impactCooldown = 1.15;
        showMessage("Margem próxima — reduza e ajuste o rumo.");
      }
    }

    for (const obstacle of obstacles) {
      if (Math.abs(obstacle.station - nextStation) < boatLengthMeters / 2 + obstacle.radius / scenePixelsPerMeter
          && Math.abs(obstacle.lateralOffset - boatX) < obstacle.radius + boatWidth / 2
          && impactCooldown === 0) {
        impactCooldown = 1.15;
        speed *= 0.45;
        boatX += boatX < obstacle.lateralOffset ? -21 : 21;
        showMessage("Opa! Desvie da pedra ou do galho.");
        break;
      }
    }

    audio.setEngineState(getEngineTelemetry());
    updateHud();
  }

  function applyThrottleStep(key) {
    if (state !== "playing") return;
    const forward = key === "ArrowUp" || key === "w" || key === "W";
    const reverse = key === "ArrowDown" || key === "s" || key === "S";
    if (fuel <= 0) {
      showMessage("Sem gasolina. A canoa precisa reabastecer.");
      return;
    }
    if (forward) speed = Math.min(maxForwardSpeed, speed + throttleStep);
    else if (reverse) speed = Math.max(-maxReverseSpeed, speed - throttleStep);
    updateHud();
  }

  function drawBank() {
    ctx.fillStyle = "#102d26";
    ctx.fillRect(0, 0, width, height);

    const currentStation = startStation + distance;
    const firstStation = Math.max(0, currentStation - 1900);
    const lastStation = Math.min(routeLength, currentStation + 1900);
    for (let station = firstStation; station <= lastStation; station += 80) {
      const center = scenePointAtStation(station);
      const edge = riverHalfWidth(station);
      for (const side of [-1, 1]) {
        for (let band = 0; band < 5; band++) {
          const seed = Math.floor(station / 80) * 19 + side * 7 + band * 31 + 80;
          const variation = seededNoise(seed);
          const bankDepth = 22 + band * 43 + seededNoise(seed + 4) * 19;
          const x = center.x + center.rightX * side * (edge + bankDepth);
          const y = center.y + center.rightY * side * (edge + bankDepth);
          const species = Math.floor(seededNoise(seed + 11) * treeModels.length);
          const size = 18 + seededNoise(seed + 17) * 18;
          const jitter = (seededNoise(seed + 2) - 0.5) * 25;
          drawTree(
            x + center.tangentX * jitter,
            y + center.tangentY * jitter,
            size,
            species,
            seed,
            variation
          );
        }
      }
    }
  }

  function drawTree(x, y, radius, species, seed, variation) {
    if (x < -radius * 2 || x > width + radius * 2) return;
    const model = treeModels[species];
    const palette = variation > 0.78
      ? ["#102f2a", "#194439", "#275a42", "#44644b"]
      : variation > 0.48
        ? ["#0c2a26", "#143c33", "#1f503b", "#3d5d48"]
        : ["#0a2522", "#11372f", "#1a4837", "#355542"];
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
    const currentStation = startStation + distance;
    const firstStation = Math.max(0, currentStation - 1900);
    const lastStation = Math.min(routeLength, currentStation + 1900);
    const step = 18;
    const water = ctx.createLinearGradient(0, 0, width, height);
    water.addColorStop(0, "#414c48");
    water.addColorStop(0.48, "#394440");
    water.addColorStop(1, "#303b38");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = water;
    for (let station = firstStation; station < lastStation; station += step) {
      const center = scenePointAtStation(station);
      const nextStation = Math.min(lastStation, station + step);
      const next = scenePointAtStation(nextStation);
      ctx.lineWidth = riverHalfWidth(station) + riverHalfWidth(nextStation);
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }
    for (let station = firstStation; station <= lastStation; station += 36) {
      const center = scenePointAtStation(station);
      for (let index = 0; index < 3; index++) {
        const seed = Math.floor(station / 36) * 13 + index;
        const noise = seededNoise(seed + currentStation);
        const offset = (noise * 2 - 1) * riverHalfWidth(station) * 0.75;
        const x = center.x + center.rightX * offset;
        const y = center.y + center.rightY * offset;
        ctx.strokeStyle = `rgba(188, 195, 179, ${0.06 + noise * 0.12})`;
        ctx.lineWidth = 1 + noise * 1.3;
        ctx.beginPath();
        ctx.moveTo(x - center.tangentX * 8, y - center.tangentY * 8);
        ctx.quadraticCurveTo(x, y, x + center.tangentX * 8, y + center.tangentY * 8);
        ctx.stroke();
      }
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#788477";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let station = firstStation; station <= lastStation; station += step) {
        const center = scenePointAtStation(station);
        const edge = side * riverHalfWidth(station);
        const x = center.x + center.rightX * edge;
        const y = center.y + center.rightY * edge;
        if (station === firstStation) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawBeaches() {
    const currentStation = startStation + distance;
    const firstStation = Math.max(0, currentStation - 1800);
    const lastStation = Math.min(routeLength, currentStation + 1800);
    for (let station = 900 + Math.ceil((firstStation - 900) / 1800) * 1800;
      station <= lastStation;
      station += 1800) {
      const side = Math.floor(station / 1800) % 2 === 0 ? -1 : 1;
      const center = scenePointAtStation(station, side * (riverHalfWidth(station) - 2));
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(Math.atan2(center.tangentY, center.tangentX));
      ctx.fillStyle = "#c5b98b";
      ctx.beginPath();
      ctx.ellipse(0, 0, 54, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawObstacle(obstacle) {
    const position = scenePointAtStation(obstacle.station, obstacle.lateralOffset);
    if (position.x < -35 || position.x > width + 35
        || position.y < -35 || position.y > height + 35) return;
    const x = position.x;
    const screenY = position.y;
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
    const station = startStation + distance;
    const position = scenePointAtStation(station, boatX);
    const tangent = routeTangentAtStation(station);
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(Math.atan2(tangent.y, tangent.x) + Math.PI / 2 + boatHeading
      + (speed < 0 ? Math.PI : 0) + (capsized ? Math.PI : 0));
    ctx.scale(boatScale, boatScale);
    ctx.fillStyle = "#10251f66";
    ctx.beginPath();
    ctx.ellipse(4, 5, 25, 82, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = capsized ? "#766c57" : "#b58b55";
    ctx.beginPath();
    ctx.moveTo(0, -78);
    ctx.quadraticCurveTo(18, -66, 20, -36);
    ctx.lineTo(17, 39);
    ctx.quadraticCurveTo(15, 68, 4, 79);
    ctx.quadraticCurveTo(0, 84, -4, 79);
    ctx.quadraticCurveTo(-15, 68, -17, 39);
    ctx.lineTo(-20, -36);
    ctx.quadraticCurveTo(-18, -66, 0, -78);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#5b4937";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    if (capsized) {
      ctx.strokeStyle = "#c5b98b";
      ctx.lineWidth = 2;
      for (let ribY = -58; ribY <= 58; ribY += 14) {
        ctx.beginPath();
        ctx.moveTo(-16, ribY);
        ctx.lineTo(16, ribY);
        ctx.stroke();
      }
      ctx.fillStyle = "#cf704d";
      ctx.beginPath();
      ctx.arc(0, 68, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#8c6941";
      ctx.beginPath();
      ctx.moveTo(0, -69);
      ctx.quadraticCurveTo(14, -55, 14, -34);
      ctx.lineTo(12, 38);
      ctx.quadraticCurveTo(10, 59, 0, 72);
      ctx.quadraticCurveTo(-10, 59, -12, 38);
      ctx.lineTo(-14, -34);
      ctx.quadraticCurveTo(-14, -55, 0, -69);
      ctx.closePath();
      ctx.fill();

      const seatY = [-44, -14, 16, 46];
      const clothes = ["#5d7481", "#879157", "#b96945", "#4d6262"];
      for (let index = 0; index < seatY.length; index++) {
        const y = seatY[index];
        ctx.fillStyle = "#d0b37d";
        ctx.fillRect(-15, y - 2, 30, 5);
        ctx.fillStyle = "#765638";
        ctx.fillRect(-16, y + 2, 3, 4);
        ctx.fillRect(13, y + 2, 3, 4);

        ctx.fillStyle = "#17241e77";
        ctx.beginPath();
        ctx.ellipse(1, y - 1, 8, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = clothes[index];
        ctx.beginPath();
        ctx.ellipse(0, y + 1, 7, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#d3a77c";
        ctx.beginPath();
        ctx.arc(0, y - 8, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#49382d";
        ctx.beginPath();
        ctx.arc(-0.5, y - 9, 5, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#d3a77c";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-5, y - 1);
        ctx.lineTo(-10, y - 5);
        ctx.moveTo(5, y - 1);
        ctx.lineTo(10, y - 5);
        ctx.stroke();
      }

      ctx.fillStyle = "#5d6260";
      ctx.beginPath();
      ctx.roundRect(-5, 76, 10, 17, 3);
      ctx.fill();
      ctx.fillStyle = "#252e2b";
      ctx.fillRect(-2, 86, 4, 11);
      ctx.strokeStyle = "#b5b5a3";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -76);
      ctx.lineTo(0, 75);
      ctx.stroke();
      ctx.strokeStyle = "#514d3c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 84);
      ctx.lineTo(9, 76);
      ctx.stroke();
      ctx.fillStyle = "#d4c392";
      ctx.beginPath();
      ctx.ellipse(-8, -73, 4, 2.5, -0.3, 0, Math.PI * 2);
      ctx.ellipse(8, -73, 4, 2.5, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawScene() {
    const station = startStation + distance;
    sceneCamera = { point: routePointAtStation(station) };
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
    let engineOscillators = [];
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

        for (let harmonic = 1; harmonic <= motor.speedLevels; harmonic++) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = harmonic === 1 ? "square" : "sine";
          oscillator.frequency.value = motor.minimumRpm / 60 * harmonic;
          gain.gain.value = 1 / harmonic;
          oscillator.connect(gain);
          gain.connect(engineGain);
          oscillator.start();
          engineOscillators.push(oscillator);
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
      setEngineState(getEngineTelemetry());
      if (birdTimer === undefined) birdTimer = window.setInterval(chirp, 1050 + Math.random() * 700);
    }

    function pause() {
      if (!context) return;
      ambienceGain.gain.setTargetAtTime(0, context.currentTime, 0.12);
      engineGain.gain.setTargetAtTime(0, context.currentTime, 0.08);
      window.clearInterval(birdTimer);
      birdTimer = undefined;
    }

    function setEngineState({ rpm, noiseDb }) {
      if (!context || state !== "playing") return;
      const now = context.currentTime;
      const fundamental = rpm / 60;
      engineOscillators.forEach((oscillator, index) => {
        oscillator.frequency.setTargetAtTime(fundamental * (index + 1), now, 0.08);
      });
      const maximumNoiseDb = motor.noiseLevelsDb[motor.speedLevels - 1];
      const amplitude = rpm === 0
        ? 0
        : motor.maximumEngineAudioGain * 10 ** ((noiseDb - maximumNoiseDb) / 20);
      engineGain.gain.setTargetAtTime(enabled ? amplitude : 0, now, 0.12);
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

    return { play, pause, setEngineState };
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
