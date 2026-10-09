(() => {
  "use strict";

  const canvas = document.querySelector("#river");
  const ctx = canvas.getContext("2d");
  const overlay = document.querySelector("#overlay");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");
  const startButton = document.querySelector("#start-button");
  const speedLabel = document.querySelector("#speed");
  const settingsButton = document.querySelector("#settings-button");
  const settingsPanel = document.querySelector("#settings-panel");
  const closeSettingsButton = document.querySelector("#close-settings");
  const saveProgressButton = document.querySelector("#save-progress");
  const restoreProgressButton = document.querySelector("#restore-progress");
  const saveStatus = document.querySelector("#save-status");
  const saveStatsList = document.querySelector("#save-stats");
  const mapTypes = ["Foto01", "Foto02", "Foto03"];
  const STORAGE_KEY = "pescariaGameSave";

  const routeLengthMeters = 15000;
  const maximumSpeedKmh = 100;
  const speedStepKmh = 20;
  const turnRate = 1.8;
  const pressedKeys = new Set();
  const boat = { x: 0, y: 0, heading: -Math.PI / 4 };

  const strips = new Map();
  const pendingStrips = new Map();
  const stripQueue = [];
  const failedStrips = new Map();
  let mapWidth = 0;
  let mapHeight = 0;
  let stripCount = 0;
  let stripLoadInProgress = false;
  let startPosition;
  let speedKmh = 0;
  let previousFrameTime = 0;
  let gameState = "ready";
  let gameProgress = null;
  let lastAutoSaveTimestamp = 0;

  function getDefaultProgress() {
    return {
      versaoDados: 3,
      dinheiroGasto: 450.5,
      tempoJogadoMinutos: 420,
      tuvirasPiaus: 25,
      anzoisArmados: 10,
      iscaPega: 0,
      peixePegoKg: 10,
      peixeVendidoKg: 5,
      valorPeixePorKg: 30,
      gasolinaAtualLitros: 4,
      estatisticas: {
        tempoJogadoMinutos: 420,
        saldoPescaria: 0
      }
    };
  }

  function normalizeProgress(rawProgress) {
    const defaultProgress = getDefaultProgress();
    const candidate = rawProgress && typeof rawProgress === "object" ? rawProgress : {};
    const isLegacySave = !(Number(candidate.versaoDados) >= defaultProgress.versaoDados);
    const mergedProgress = {
      ...defaultProgress,
      ...candidate,
      versaoDados: defaultProgress.versaoDados,
      estatisticas: { ...defaultProgress.estatisticas, ...(candidate.estatisticas || {}) }
    };

    mergedProgress.dinheiroGasto = Number(mergedProgress.dinheiroGasto) || 0;
    mergedProgress.tempoJogadoMinutos = Number(mergedProgress.tempoJogadoMinutos) || 0;
    mergedProgress.tuvirasPiaus = Number(
      candidate.tuvirasPiaus ?? candidate.Tuviras_Piaus ?? candidate.iscasAtuais?.tuvira ?? defaultProgress.tuvirasPiaus
    ) || 0;
    mergedProgress.anzoisArmados = Number(mergedProgress.anzoisArmados) || 0;
    mergedProgress.iscaPega = Number(mergedProgress.iscaPega) || 0;
    mergedProgress.peixePegoKg = Number(mergedProgress.peixePegoKg) || 0;
    mergedProgress.peixeVendidoKg = Number(mergedProgress.peixeVendidoKg) || 0;
    mergedProgress.valorPeixePorKg = isLegacySave
      ? defaultProgress.valorPeixePorKg
      : Number(mergedProgress.valorPeixePorKg) || 0;
    mergedProgress.gasolinaAtualLitros = Number(
      candidate.gasolinaAtualLitros ?? candidate.gasolinaAtual ?? defaultProgress.gasolinaAtualLitros
    ) || 0;
    mergedProgress.estatisticas.tempoJogadoMinutos = Number(mergedProgress.estatisticas.tempoJogadoMinutos) || 0;
    mergedProgress.estatisticas.saldoPescaria = calculateFishingBalance(mergedProgress);

    return mergedProgress;
  }

  function calculateFishingBalance(progress) {
    const expenses = Number(progress.dinheiroGasto) || 0;
    const revenue = (Number(progress.peixeVendidoKg) || 0) * (Number(progress.valorPeixePorKg) || 0);
    return revenue - expenses;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
  }

  function renderSaveStats() {
    if (!saveStatsList) return;

    const currentProgress = normalizeProgress(gameProgress);
    const entries = [
      { label: "Dinheiro gasto", value: formatCurrency(currentProgress.dinheiroGasto) },
      { label: "Tempo jogado", value: `${(Number(currentProgress.tempoJogadoMinutos) || 0).toFixed(1)} min` },
      { label: "Tuviras e piaus", value: `${currentProgress.tuvirasPiaus} itens` },
      { label: "Anzóis armados", value: `${currentProgress.anzoisArmados}` },
      { label: "Iscas pegas", value: `${currentProgress.iscaPega}` },
      { label: "Peixe pego", value: `${(Number(currentProgress.peixePegoKg) || 0).toFixed(1)} kg` },
      { label: "Peixe vendido", value: `${(Number(currentProgress.peixeVendidoKg) || 0).toFixed(1)} kg` },
      { label: "Valor do peixe", value: formatCurrency(currentProgress.valorPeixePorKg) },
      { label: "Gasolina atual", value: `${(Number(currentProgress.gasolinaAtualLitros) || 0).toFixed(1)} L` },
      { label: "Saldo da pescaria", value: formatCurrency(currentProgress.estatisticas.saldoPescaria) }
    ];

    saveStatsList.innerHTML = entries.map(({ label, value }) => `
      <li><span>${label}</span><strong>${value}</strong></li>
    `).join("");
  }

  function loadProgress() {
    try {
      const savedProgress = localStorage.getItem(STORAGE_KEY);
      if (!savedProgress) {
        gameProgress = normalizeProgress(getDefaultProgress());
        return false;
      }
      gameProgress = normalizeProgress(JSON.parse(savedProgress));
      return true;
    } catch (error) {
      console.error("Não foi possível recuperar o progresso salvo.", error);
      gameProgress = normalizeProgress(getDefaultProgress());
      return false;
    }
  }

  function saveProgress() {
    try {
      const progressToSave = normalizeProgress(gameProgress);
      progressToSave.estatisticas.tempoJogadoMinutos = Number(progressToSave.tempoJogadoMinutos) || 0;
      progressToSave.estatisticas.saldoPescaria = calculateFishingBalance(progressToSave);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progressToSave));
      gameProgress = progressToSave;
      renderSaveStats();
      if (saveStatus) {
        saveStatus.textContent = `Dados salvos em ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
      }
      return true;
    } catch (error) {
      console.error("Não foi possível salvar o progresso do jogo.", error);
      if (saveStatus) {
        saveStatus.textContent = "Não foi possível salvar no armazenamento do navegador.";
      }
      return false;
    }
  }

  function restoreProgress() {
    const restored = loadProgress();
    renderSaveStats();
    if (saveStatus) {
      saveStatus.textContent = restored
        ? "Dados recuperados com sucesso."
        : "Nenhum dado salvo encontrado; iniciou um novo progresso.";
    }
    return restored;
  }

  function toggleSettingsPanel(forceOpen) {
    if (!settingsPanel) return;
    const nextState = typeof forceOpen === "boolean" ? forceOpen : settingsPanel.hidden;
    settingsPanel.hidden = !nextState;
    if (settingsButton) {
      settingsButton.setAttribute("aria-expanded", String(nextState));
    }
  }

  function updateProgressFromGame(timeDeltaSeconds) {
    if (!gameProgress) {
      gameProgress = normalizeProgress(getDefaultProgress());
    }

    gameProgress.tempoJogadoMinutos = Number(gameProgress.tempoJogadoMinutos || 0) + timeDeltaSeconds / 60;
    gameProgress.estatisticas.tempoJogadoMinutos = Number(gameProgress.tempoJogadoMinutos);
    gameProgress.estatisticas.saldoPescaria = calculateFishingBalance(gameProgress);
    renderSaveStats();
  }

  function updateSpeed() {
    speedLabel.textContent = `${Math.round(speedKmh)} km/h`;
  }

  function changeSpeedLevel(amount) {
    const currentLevel = Math.round(speedKmh / speedStepKmh);
    const maximumLevel = maximumSpeedKmh / speedStepKmh;
    speedKmh = Math.max(0, Math.min(maximumLevel, currentLevel + amount)) * speedStepKmh;
    updateSpeed();
  }

  function isGreenStart(r, g, b) {
    return Math.abs(r - 34) < 35 && Math.abs(g - 177) < 45 && Math.abs(b - 76) < 38;
  }

  function isOrangeRiver(r, g, b) {
    return r >= 245 && g >= 115 && g <= 145 && b <= 15;
  }

  function waitForImage(image) {
    if (image.complete) {
      return image.naturalWidth > 0
        ? Promise.resolve()
        : Promise.reject(new Error(`Não foi possível carregar ${image.src}.`));
    }
    return new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error(`Não foi possível carregar ${image.src}.`)), { once: true });
    });
  }

  function getStripBounds(index) {
    const bottom = mapHeight - Math.floor(index * mapHeight / stripCount);
    const top = mapHeight - Math.floor((index + 1) * mapHeight / stripCount);
    return { top, height: bottom - top };
  }

  function readImagePixels(image) {
    const offscreen = document.createElement("canvas");
    offscreen.width = image.naturalWidth;
    offscreen.height = image.naturalHeight;
    const offscreenContext = offscreen.getContext("2d", { willReadFrequently: true });
    offscreenContext.drawImage(image, 0, 0);
    const pixels = offscreenContext.getImageData(0, 0, offscreen.width, offscreen.height).data;
    offscreen.width = 0;
    offscreen.height = 0;
    return pixels;
  }

  async function loadStrip(index) {
    const bounds = getStripBounds(index);
    const images = mapTypes.map(type => {
      const image = new Image();
      const fileNumber = String(index + 1).padStart(2, "0");
      image.src = new URL(`maps/${type}-${fileNumber}.png`, document.baseURI).href;
      return image;
    });
    await Promise.all(images.map(waitForImage));

    if (images.some(image => image.naturalWidth !== mapWidth || image.naturalHeight !== bounds.height)) {
      throw new Error(`As imagens da faixa ${index + 1} têm dimensões inesperadas.`);
    }

    const navigationPixels = readImagePixels(images[2]);
    const navigationMask = new Uint8Array(mapWidth * bounds.height);
    let navigablePixels = 0;
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const pixelIndex = (y * mapWidth + x) * 4;
        if (isOrangeRiver(navigationPixels[pixelIndex], navigationPixels[pixelIndex + 1], navigationPixels[pixelIndex + 2])) {
          navigationMask[y * mapWidth + x] = 1;
          navigablePixels++;
        }
      }
      if ((y + 1) % 32 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
    }

    if (index === 0 && navigablePixels === 0) {
      throw new Error("Não foi possível identificar a área navegável na faixa inferior de Foto03.png.");
    }

    if (index === 0) {
      const startPixels = readImagePixels(images[1]);
      let greenPixels = 0;
      let greenXTotal = 0;
      let greenYTotal = 0;
      for (let y = 0; y < bounds.height; y++) {
        for (let x = 0; x < mapWidth; x++) {
          const pixelIndex = (y * mapWidth + x) * 4;
          if (isGreenStart(startPixels[pixelIndex], startPixels[pixelIndex + 1], startPixels[pixelIndex + 2])) {
            greenXTotal += x;
            greenYTotal += bounds.top + y;
            greenPixels++;
          }
        }
        if ((y + 1) % 32 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
      }

      if (greenPixels === 0) throw new Error("Não foi possível localizar a partida na faixa inferior de Foto02.png.");

      startPosition = {
        x: greenXTotal / greenPixels + 0.5,
        y: greenYTotal / greenPixels + 0.5
      };
      boat.x = startPosition.x;
      boat.y = startPosition.y;
    }

    return { image: images[0], navigationMask, top: bounds.top, height: bounds.height };
  }

  function processStripQueue() {
    if (stripLoadInProgress) return;

    stripQueue.sort((first, second) => first.priority - second.priority || first.index - second.index);
    const job = stripQueue.shift();
    if (!job) return;
    if (pendingStrips.get(job.index) !== job) {
      processStripQueue();
      return;
    }

    stripLoadInProgress = true;
    loadStrip(job.index)
      .then(strip => {
        strips.set(job.index, strip);
        failedStrips.delete(job.index);
        render();
        job.resolve(strip);
      })
      .catch(error => {
        failedStrips.set(job.index, error);
        job.reject(error);
      })
      .finally(() => {
        pendingStrips.delete(job.index);
        stripLoadInProgress = false;
        processStripQueue();
      });
  }

  function ensureStrip(index, priority = 0) {
    if (index < 0 || index >= stripCount || strips.has(index)) return Promise.resolve();
    const pending = pendingStrips.get(index);
    if (pending) {
      pending.priority = Math.min(pending.priority, priority);
      return pending.promise;
    }

    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const job = { index, priority, promise, resolve, reject };
    pendingStrips.set(index, job);
    stripQueue.push(job);
    processStripQueue();
    return promise;
  }

  function scheduleStrip(index) {
    if (index < 0 || index >= stripCount || strips.has(index) || failedStrips.has(index)) return;
    ensureStrip(index, 0).catch(error => console.error(`Não foi possível carregar a faixa ${index + 1} do mapa.`, error));
  }

  function requestNearbyStrips() {
    if (!startPosition) return;
    const currentIndex = getStripIndex(boat.y);
    for (let index = Math.max(0, currentIndex - 1); index <= Math.min(stripCount - 1, currentIndex + 1); index++) {
      scheduleStrip(index);
    }
  }

  function showMapError(error, index) {
    gameState = "error";
    speedKmh = 0;
    pressedKeys.clear();
    updateSpeed();
    overlay.hidden = false;
    overlayTitle.textContent = "Não foi possível carregar o mapa";
    overlayCopy.textContent = `${index === null ? "" : `Faixa ${index + 1}: `}${error.message} Atualize a página para tentar novamente.`;
    startButton.disabled = true;
    startButton.textContent = "MAPA INDISPONÍVEL";
  }

  async function preloadRemainingStrips() {
    for (let index = 1; index < stripCount; index++) {
      if (strips.has(index)) continue;
      try {
        await ensureStrip(index, 1);
      } catch (error) {
        console.error(`Não foi possível pré-carregar a faixa ${index + 1} do mapa.`, error);
      }
    }
  }

  function isNavigableAt(x, y) {
    const maskX = Math.round(x);
    const maskY = Math.round(y);
    if (maskX < 0 || maskX >= mapWidth || maskY < 0 || maskY >= mapHeight) return false;

    const index = getStripIndex(maskY);
    const strip = strips.get(index);
    if (!strip) return null;
    return strip.navigationMask[(maskY - strip.top) * mapWidth + maskX] === 1;
  }

  function getStripIndex(y) {
    const mapY = Math.max(0, Math.min(mapHeight - 1, Math.round(y)));
    return stripCount - 1 - Math.floor(mapY * stripCount / mapHeight);
  }

  function staysInNavigableArea(fromX, fromY, toX, toY) {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance / 3));
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const x = fromX + (toX - fromX) * progress;
      const y = fromY + (toY - fromY) * progress;
      const navigable = isNavigableAt(x, y);
      if (navigable === null) return null;
      if (!navigable) return false;
    }
    return true;
  }

  function resizeCanvas() {
    const bounds = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(bounds.width * pixelRatio);
    canvas.height = Math.round(bounds.height * pixelRatio);
    render();
  }

  function getZoom(width) {
    const previousZoom = Math.min(2.2, Math.min(0.55, width / mapWidth) * 4);
    return previousZoom * 2;
  }

  function moveBoat(delta) {
    const steeringRate = speedKmh > speedStepKmh * 2 ? turnRate * 0.25 : turnRate;
    if (pressedKeys.has("ArrowLeft")) boat.heading -= steeringRate * delta;
    if (pressedKeys.has("ArrowRight")) boat.heading += steeringRate * delta;

    if (speedKmh === 0) {
      return;
    }

    const pixelsPerMeter = mapHeight / routeLengthMeters;
    const distance = speedKmh / 3.6 * pixelsPerMeter * delta;
    const nextX = boat.x + Math.cos(boat.heading) * distance;
    const nextY = boat.y + Math.sin(boat.heading) * distance;

    const navigable = staysInNavigableArea(boat.x, boat.y, nextX, nextY);
    if (navigable === null) {
      requestNearbyStrips();
      const neededIndex = getStripIndex(nextY);
      if (failedStrips.has(neededIndex)) {
        showMapError(failedStrips.get(neededIndex), neededIndex);
      }
      return;
    }
    if (!navigable) {
      speedKmh = 0;
      return;
    }

    boat.x = nextX;
    boat.y = nextY;
    requestNearbyStrips();
  }

  function drawBoat(x, y, pixelRatio) {
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.translate(x, y);
    ctx.rotate(boat.heading + Math.PI / 2);
    ctx.scale(0.5, 0.5);
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(12, 13);
    ctx.lineTo(0, 7);
    ctx.lineTo(-12, 13);
    ctx.closePath();
    ctx.fillStyle = "#ed302d";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff5e8";
    ctx.stroke();
  }

  function getBoatScreenPosition() {
    const pixelRatio = window.devicePixelRatio || 1;
    const width = canvas.width / pixelRatio;
    const height = canvas.height / pixelRatio;
    const zoom = getZoom(width);
    const boatScreenY = height * 0.68;
    const renderedMapWidth = mapWidth * zoom;
    const renderedMapHeight = mapHeight * zoom;
    const requestedOffsetX = width / 2 - boat.x * zoom;
    const requestedOffsetY = boatScreenY - boat.y * zoom;
    const offsetX = renderedMapWidth <= width
      ? (width - renderedMapWidth) / 2
      : requestedOffsetX;
    const offsetY = renderedMapHeight <= height
      ? (height - renderedMapHeight) / 2
      : requestedOffsetY;
    return {
      x: offsetX + boat.x * zoom,
      y: offsetY + boat.y * zoom
    };
  }

  function handleCanvasPointer(event) {
    if (gameState !== "playing" || mapWidth === 0) return;

    const bounds = canvas.getBoundingClientRect();
    const boatPosition = getBoatScreenPosition();
    const dx = event.clientX - bounds.left - boatPosition.x;
    const dy = event.clientY - bounds.top - boatPosition.y;
    const forward = dx * Math.cos(boat.heading) + dy * Math.sin(boat.heading);
    const lateral = -dx * Math.sin(boat.heading) + dy * Math.cos(boat.heading);

    if (forward > Math.abs(lateral)) {
      changeSpeedLevel(1);
    } else if (-forward > Math.abs(lateral)) {
      changeSpeedLevel(-1);
    } else if (Math.abs(lateral) > 8) {
      const tightTurn = speedKmh <= speedStepKmh * 2;
      const turnAngle = tightTurn ? Math.PI / 4 : Math.PI / 15;
      boat.heading += Math.sign(lateral) * turnAngle;
    }

    event.preventDefault();
  }

  function render() {
    if (!ctx || !mapWidth || strips.size === 0) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const width = canvas.width / pixelRatio;
    const height = canvas.height / pixelRatio;
    const zoom = getZoom(width);
    const boatScreenY = height * 0.68;
    const renderedMapWidth = mapWidth * zoom;
    const renderedMapHeight = mapHeight * zoom;
    const requestedOffsetX = width / 2 - boat.x * zoom;
    const requestedOffsetY = boatScreenY - boat.y * zoom;
    const offsetX = renderedMapWidth <= width
      ? (width - renderedMapWidth) / 2
      : requestedOffsetX;
    const offsetY = renderedMapHeight <= height
      ? (height - renderedMapHeight) / 2
      : requestedOffsetY;

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = "#101b17";
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(
      pixelRatio * zoom,
      0,
      0,
      pixelRatio * zoom,
      pixelRatio * offsetX,
      pixelRatio * offsetY
    );
    for (const strip of strips.values()) {
      const stripScreenTop = offsetY + strip.top * zoom;
      if (stripScreenTop + strip.height * zoom < 0 || stripScreenTop > height) continue;
      ctx.drawImage(strip.image, 0, strip.top);
    }
    drawBoat(
      offsetX + boat.x * zoom,
      offsetY + boat.y * zoom,
      pixelRatio
    );
  }

  function startNavigation() {
    gameState = "playing";
    pressedKeys.clear();
    overlay.hidden = true;
    previousFrameTime = performance.now();
    lastAutoSaveTimestamp = previousFrameTime;
    if (!gameProgress) {
      gameProgress = normalizeProgress(getDefaultProgress());
    }
    updateSpeed();
    requestNearbyStrips();
    canvas.focus({ preventScroll: true });
  }

  function frame(time) {
    if (gameState === "playing") {
      const elapsed = Math.max(0, (time - previousFrameTime) / 1000);
      moveBoat(Math.min(elapsed, 0.05));
      updateProgressFromGame(Math.min(elapsed, 0.05));
      if (time - lastAutoSaveTimestamp >= 15000) {
        saveProgress();
        lastAutoSaveTimestamp = time;
      }
      updateSpeed();
    } else if (gameState === "ready") {
      requestNearbyStrips();
    }
    previousFrameTime = time;
    render();
    window.requestAnimationFrame(frame);
  }

  startButton.addEventListener("click", startNavigation);
  window.addEventListener("keydown", event => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      if (gameState === "playing" && !event.repeat) {
        if (event.key === "ArrowUp") {
          changeSpeedLevel(1);
        } else if (event.key === "ArrowDown") {
          changeSpeedLevel(-1);
        } else {
          pressedKeys.add(event.key);
        }
      }
    }
  });
  window.addEventListener("keyup", event => {
    if (pressedKeys.delete(event.key)) updateSpeed();
  });
  window.addEventListener("blur", () => {
    pressedKeys.clear();
    updateSpeed();
  });
  canvas.addEventListener("pointerdown", handleCanvasPointer);
  window.addEventListener("resize", resizeCanvas);
  if (settingsButton) {
    settingsButton.addEventListener("click", () => toggleSettingsPanel());
  }
  if (closeSettingsButton) {
    closeSettingsButton.addEventListener("click", () => toggleSettingsPanel(false));
  }
  if (saveProgressButton) {
    saveProgressButton.addEventListener("click", () => {
      saveProgress();
      toggleSettingsPanel(true);
    });
  }
  if (restoreProgressButton) {
    restoreProgressButton.addEventListener("click", () => {
      restoreProgress();
      toggleSettingsPanel(true);
    });
  }
  window.addEventListener("beforeunload", saveProgress);

  async function initialize() {
    loadProgress();
    renderSaveStats();
    if (saveStatus) {
      const hasProgress = Boolean(gameProgress);
      saveStatus.textContent = hasProgress && localStorage.getItem(STORAGE_KEY)
        ? "Dados do celular recuperados automaticamente."
        : "Nenhum dado salvo ainda. Você pode salvar no celular quando quiser.";
    }

    try {
      const response = await fetch(new URL("maps/manifest.json", document.baseURI));
      if (!response.ok) throw new Error(`Não foi possível carregar a configuração dos mapas (HTTP ${response.status}).`);
      const manifest = await response.json();
      if (!Number.isInteger(manifest.width) || !Number.isInteger(manifest.height) ||
          !Number.isInteger(manifest.strips) || manifest.width <= 0 ||
          manifest.height <= 0 || manifest.strips <= 0) {
        throw new Error("A configuração dos mapas está inválida.");
      }
      mapWidth = manifest.width;
      mapHeight = manifest.height;
      stripCount = manifest.strips;
      await ensureStrip(0);
      startButton.disabled = false;
      startButton.textContent = "INICIAR NAVEGAÇÃO";
      render();
      preloadRemainingStrips();
    } catch (error) {
      console.error("Não foi possível preparar os mapas para a navegação.", error);
      showMapError(error, null);
    }
  }

  updateSpeed();
  resizeCanvas();
  window.requestAnimationFrame(frame);
  initialize();
})();
