const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_RASTER_DIMENSION = 320;
const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("#drop-zone");
const status = document.querySelector("#status");
const resultSection = document.querySelector("#result-section");
const sourceName = document.querySelector("#source-name");
const sourceSize = document.querySelector("#source-size");
const sourcePreview = document.querySelector("#source-preview");
const outputPreview = document.querySelector("#output-preview");
const paletteElement = document.querySelector("#palette");
const downloadButton = document.querySelector("#download-button");
const resetButton = document.querySelector("#reset-button");
const reductionMode = document.querySelector("#reduction-mode");
const thresholdControls = document.querySelector("#threshold-controls");
const thresholdInputs = [1, 2, 3].map((number) => document.querySelector(`#threshold-${number}`));
const thresholdOutputs = [1, 2, 3].map((number) => document.querySelector(`#threshold-${number}-value`));
const autoThresholdsButton = document.querySelector("#auto-thresholds");
const mirrorPreview = document.querySelector("#mirror-preview");
let convertedSvg = "";
let downloadName = "makerworld.svg";
let previewUrls = [];
let activeRaster = null;
let activeFile = null;
let suggestedThresholds = [64, 128, 192];
let renderFrame = 0;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function revokePreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
}

function createPreviewUrl(content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  previewUrls.push(url);
  return url;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The PNG could not be decoded."));
    };
    image.src = url;
  });
}

function rasterize(image) {
  const factor = Math.min(1, MAX_RASTER_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * factor));
  const height = Math.max(1, Math.round(image.naturalHeight * factor));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

function showPalette(colors) {
  paletteElement.replaceChildren();
  const slots = AMSConverterCore.colorSlots(colors.length);
  colors.forEach((color, index) => {
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    const colorBox = document.createElement("span");
    colorBox.className = "swatch-color";
    colorBox.style.background = color;
    const label = document.createElement("span");
    label.textContent = `color_${slots[index]} · ${color}`;
    swatch.append(colorBox, label);
    paletteElement.append(swatch);
  });
}

function currentThresholds() {
  return thresholdInputs.map((input) => Number(input.value));
}

function setThresholds(values) {
  const safe = [...values];
  safe[0] = Math.max(1, Math.min(253, safe[0]));
  safe[1] = Math.max(safe[0] + 1, Math.min(254, safe[1]));
  safe[2] = Math.max(safe[1] + 1, Math.min(255, safe[2]));
  thresholdInputs[0].min = "1";
  thresholdInputs[0].max = "253";
  thresholdInputs[1].min = "2";
  thresholdInputs[1].max = "254";
  thresholdInputs[2].min = "3";
  thresholdInputs[2].max = "255";
  thresholdInputs.forEach((input, index) => {
    input.value = safe[index];
    thresholdOutputs[index].value = safe[index];
  });
  thresholdInputs[0].max = String(safe[1] - 1);
  thresholdInputs[1].min = String(safe[0] + 1);
  thresholdInputs[1].max = String(safe[2] - 1);
  thresholdInputs[2].min = String(safe[1] + 1);
}

function renderConversion() {
  if (!activeRaster || !activeFile) return;
  const result = reductionMode.value === "thresholds"
    ? AMSConverterCore.quantizeByLuminanceThresholds(activeRaster.data, activeRaster.width, activeRaster.height, currentThresholds())
    : AMSConverterCore.quantize(activeRaster.data, activeRaster.width, activeRaster.height, 4);
  const mirroredLabels = AMSConverterCore.mirrorLabelsHorizontally(result.labels, activeRaster.width, activeRaster.height);
  const paths = AMSConverterCore.pathsFromLabels(mirroredLabels, activeRaster.width, activeRaster.height, result.palette.length);
  convertedSvg = AMSConverterCore.buildSvg(paths, result.palette, activeRaster.width, activeRaster.height);
  if (outputPreview.src.startsWith("blob:")) URL.revokeObjectURL(outputPreview.src);
  outputPreview.src = createPreviewUrl(convertedSvg, "image/svg+xml");
  showPalette(result.palette);
  setStatus(`Ready. ${result.palette.length} color${result.palette.length === 1 ? "" : "s"} detected.`);
}

function scheduleConversion() {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    try {
      renderConversion();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The PNG could not be converted.", true);
    }
  });
}

async function processFile(file) {
  if (!file || (!file.name.toLowerCase().endsWith(".png") && file.type !== "image/png")) {
    setStatus("Choose a PNG file.", true);
    return;
  }
  if (file.size > MAX_INPUT_BYTES) {
    setStatus("The PNG is too large. Maximum file size is 10 MB.", true);
    return;
  }
  setStatus("Detecting colors and building vector groups…");
  try {
    const image = await loadImage(file);
    const raster = rasterize(image);
    activeRaster = raster;
    activeFile = file;
    suggestedThresholds = AMSConverterCore.suggestLuminanceThresholds(raster.data);
    setThresholds(suggestedThresholds);
    reductionMode.value = "smart";
    thresholdControls.hidden = true;
    downloadName = `${file.name.replace(/\.png$/i, "")}_makerworld.svg`;
    revokePreviewUrls();
    sourcePreview.src = createPreviewUrl(file, "image/png");
    sourceName.textContent = file.name;
    sourceSize.textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
    renderConversion();
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    convertedSvg = "";
    resultSection.hidden = true;
    setStatus(error instanceof Error ? error.message : "The PNG could not be converted.", true);
  }
}

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => processFile(fileInput.files?.[0]));
["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
}));
dropZone.addEventListener("drop", (event) => processFile(event.dataTransfer?.files?.[0]));
downloadButton.addEventListener("click", () => {
  if (!convertedSvg) return;
  const url = URL.createObjectURL(new Blob([convertedSvg], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadName;
  link.click();
  URL.revokeObjectURL(url);
});
resetButton.addEventListener("click", () => {
  fileInput.value = "";
  convertedSvg = "";
  activeRaster = null;
  activeFile = null;
  mirrorPreview.checked = true;
  outputPreview.classList.remove("is-unmirrored");
  resultSection.hidden = true;
  revokePreviewUrls();
  setStatus("No file selected");
  dropZone.focus();
});

reductionMode.addEventListener("change", () => {
  thresholdControls.hidden = reductionMode.value !== "thresholds";
  scheduleConversion();
});
thresholdInputs.forEach((input, changedIndex) => input.addEventListener("input", () => {
  const values = currentThresholds();
  if (changedIndex === 0) values[0] = Math.min(values[0], values[1] - 1);
  if (changedIndex === 1) values[1] = Math.max(values[0] + 1, Math.min(values[1], values[2] - 1));
  if (changedIndex === 2) values[2] = Math.max(values[1] + 1, values[2]);
  setThresholds(values);
  scheduleConversion();
}));
autoThresholdsButton.addEventListener("click", () => {
  setThresholds(suggestedThresholds);
  scheduleConversion();
});
mirrorPreview.addEventListener("change", () => {
  outputPreview.classList.toggle("is-unmirrored", !mirrorPreview.checked);
});
