(() => {
  "use strict";

  const canvas = document.querySelector("#river");
  const ctx = canvas.getContext("2d");
  const mapImage = document.querySelector("#map-image");
  const boundaryImage = document.querySelector("#boundary-map");
  const navigationMap = document.querySelector("#navigation-map");
  const overlay = document.querySelector("#overlay");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");
  const startButton = document.querySelector("#start-button");
  const speedLabel = document.querySelector("#speed");

  const routeLengthMeters = 15000;
  const maximumSpeedKmh = 100;
  const accelerationKmhPerSecond = 36;
  const brakingKmhPerSecond = 55;
  const maskScale = 1;
  const turnRate = 1.8;
  const pressedKeys = new Set();
  const boat = { x: 0, y: 0, heading: -Math.PI / 4 };

  let navigationMask;
  let maskWidth = 0;
  let maskHeight = 0;
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

  function createNavigationMask() {
    if (mapImage.naturalWidth !== boundaryImage.naturalWidth ||
        mapImage.naturalHeight !== boundaryImage.naturalHeight ||
        mapImage.naturalWidth !== navigationMap.naturalWidth ||
        mapImage.naturalHeight !== navigationMap.naturalHeight) {
      throw new Error("As três fotos do mapa precisam ter as mesmas dimensões.");
    }

    maskWidth = Math.ceil(navigationMap.naturalWidth * maskScale);
    maskHeight = Math.ceil(navigationMap.naturalHeight * maskScale);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    maskContext.imageSmoothingEnabled = false;
    maskContext.drawImage(navigationMap, 0, 0, maskWidth, maskHeight);

    const pixels = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    navigationMask = new Uint8Array(maskWidth * maskHeight);
    let navigablePixels = 0;
    for (let y = 0; y < maskHeight; y++) {
      for (let x = 0; x < maskWidth; x++) {
        const pixelIndex = (y * maskWidth + x) * 4;
        if (isOrangeRiver(pixels[pixelIndex], pixels[pixelIndex + 1], pixels[pixelIndex + 2])) {
          navigationMask[y * maskWidth + x] = 1;
          navigablePixels++;
        }
      }
    }
    maskCanvas.width = 0;
    maskCanvas.height = 0;

    if (navigablePixels === 0) throw new Error("Não foi possível identificar a área laranja navegável da Foto03.png.");

    const startCanvas = document.createElement("canvas");
    startCanvas.width = maskWidth;
    startCanvas.height = maskHeight;
    const startContext = startCanvas.getContext("2d", { willReadFrequently: true });
    startContext.imageSmoothingEnabled = false;
    startContext.drawImage(boundaryImage, 0, 0, maskWidth, maskHeight);
    const startPixels = startContext.getImageData(0, 0, maskWidth, maskHeight).data;
    let greenPixels = 0;
    let greenXTotal = 0;
    let greenYTotal = 0;

    for (let y = 0; y < maskHeight; y++) {
      for (let x = 0; x < maskWidth; x++) {
        const pixelIndex = (y * maskWidth + x) * 4;
        const r = startPixels[pixelIndex];
        const g = startPixels[pixelIndex + 1];
        const b = startPixels[pixelIndex + 2];
        if (isGreenStart(r, g, b)) {
          greenXTotal += x;
          greenYTotal += y;
          greenPixels++;
        }
      }
    }
    startCanvas.width = 0;
    startCanvas.height = 0;

    if (greenPixels === 0) throw new Error("Não foi possível identificar a área verde de partida na Foto02.png.");

    startPosition = {
      x: (greenXTotal / greenPixels + 0.5) / maskScale,
      y: (greenYTotal / greenPixels + 0.5) / maskScale
    };
    boat.x = startPosition.x;
    boat.y = startPosition.y;
  }

  function isNavigableAt(x, y) {
    const maskX = Math.round(x * maskScale);
    const maskY = Math.round(y * maskScale);
    return maskX >= 0 && maskX < maskWidth &&
      maskY >= 0 && maskY < maskHeight &&
      navigationMask[maskY * maskWidth + maskX] === 1;
  }

  function staysInNavigableArea(fromX, fromY, toX, toY) {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance / 3));
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const x = fromX + (toX - fromX) * progress;
      const y = fromY + (toY - fromY) * progress;
      if (!isNavigableAt(x, y)) return false;
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
    const previousZoom = Math.min(2.2, Math.min(0.55, width / mapImage.naturalWidth) * 4);
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

    const pixelsPerMeter = mapImage.naturalHeight / routeLengthMeters;
    const distance = speedKmh / 3.6 * pixelsPerMeter * delta;
    const nextX = boat.x + Math.cos(boat.heading) * distance;
    const nextY = boat.y + Math.sin(boat.heading) * distance;

    if (!staysInNavigableArea(boat.x, boat.y, nextX, nextY)) {
      speedKmh = 0;
      return;
    }

    boat.x = nextX;
    boat.y = nextY;
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
    if (!ctx || !mapImage.complete || !mapImage.naturalWidth) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const width = canvas.width / pixelRatio;
    const height = canvas.height / pixelRatio;
    const zoom = getZoom(width);
    const boatScreenY = height * 0.68;
    const renderedMapWidth = mapImage.naturalWidth * zoom;
    const renderedMapHeight = mapImage.naturalHeight * zoom;
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
    ctx.drawImage(mapImage, 0, 0);
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
    canvas.focus({ preventScroll: true });
  }

  function frame(time) {
    if (gameState === "playing") {
      const elapsed = Math.max(0, (time - previousFrameTime) / 1000);
      moveBoat(Math.min(elapsed, 0.05));
      updateSpeed();
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
      await Promise.all([
        waitForImage(mapImage),
        waitForImage(boundaryImage),
        waitForImage(navigationMap)
      ]);
      createNavigationMask();
      startButton.disabled = false;
      startButton.textContent = "INICIAR NAVEGAÇÃO";
      render();
    } catch (error) {
      console.error("Não foi possível preparar os mapas para a navegação.", error);
      overlayTitle.textContent = "Não foi possível carregar o mapa";
      overlayCopy.textContent = error.message;
      startButton.textContent = "MAPA INDISPONÍVEL";
    }
  }

  updateSpeed();
  resizeCanvas();
  window.requestAnimationFrame(frame);
  initialize();
})();
