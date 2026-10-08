(() => {
  "use strict";

  const canvas = document.querySelector("#river");
  const ctx = canvas.getContext("2d");
  const overlay = document.querySelector("#overlay");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");
  const startButton = document.querySelector("#start-button");
  const speedLabel = document.querySelector("#speed");
  const mapTypes = ["Foto01", "Foto02", "Foto03"];

  const routeLengthMeters = 15000;
  const maximumSpeedKmh = 100;
  const accelerationKmhPerSecond = 36;
  const brakingKmhPerSecond = 55;
  const turnRate = 1.8;
  const pressedKeys = new Set();
  const boat = { x: 0, y: 0, heading: -Math.PI / 4 };

  const strips = new Map();
  const pendingStrips = new Map();
  const failedStrips = new Map();
  let mapWidth = 0;
  let mapHeight = 0;
  let stripCount = 0;
  let startPosition;
  let speedKmh = 0;
  let previousFrameTime = 0;
  let gameState = "ready";

  function updateSpeed() {
    speedLabel.textContent = `${Math.round(speedKmh)} km/h`;
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

  function ensureStrip(index) {
    if (index < 0 || index >= stripCount || strips.has(index)) return Promise.resolve();
    if (pendingStrips.has(index)) return pendingStrips.get(index);

    const request = loadStrip(index)
      .then(strip => {
        strips.set(index, strip);
        failedStrips.delete(index);
        render();
      })
      .catch(error => {
        failedStrips.set(index, error);
        throw error;
      })
      .finally(() => pendingStrips.delete(index));
    pendingStrips.set(index, request);
    return request;
  }

  function scheduleStrip(index) {
    if (index < 0 || index >= stripCount || strips.has(index) || failedStrips.has(index)) return;
    ensureStrip(index).catch(error => console.error(`Não foi possível carregar a faixa ${index + 1} do mapa.`, error));
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
    if (pressedKeys.has("ArrowLeft")) boat.heading -= turnRate * delta;
    if (pressedKeys.has("ArrowRight")) boat.heading += turnRate * delta;

    if (pressedKeys.has("ArrowDown")) {
      speedKmh = Math.max(0, speedKmh - brakingKmhPerSecond * delta);
    } else if (pressedKeys.has("ArrowUp")) {
      speedKmh = Math.min(maximumSpeedKmh, speedKmh + accelerationKmhPerSecond * delta);
    }

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
    updateSpeed();
    requestNearbyStrips();
    canvas.focus({ preventScroll: true });
  }

  function frame(time) {
    if (gameState === "playing") {
      const elapsed = Math.max(0, (time - previousFrameTime) / 1000);
      moveBoat(Math.min(elapsed, 0.05));
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
      if (gameState === "playing") {
        pressedKeys.add(event.key);
        updateSpeed();
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
  window.addEventListener("resize", resizeCanvas);

  async function initialize() {
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
