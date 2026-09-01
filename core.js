(function exposeConverter(global) {
  "use strict";

  function luminance(color) {
    return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  }

  function colorDistance(a, b) {
    const red = a[0] - b[0];
    const green = a[1] - b[1];
    const blue = a[2] - b[2];
    return red * red + green * green + blue * blue;
  }

  function colorHex(color) {
    return `#${color.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;
  }

  function detectEdgeColor(data, width, height, alphaThreshold = 24) {
    const buckets = new Map();
    const visit = (x, y) => {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < alphaThreshold) return;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const key = `${red >> 4},${green >> 4},${blue >> 4}`;
      const bucket = buckets.get(key) || [0, 0, 0, 0];
      bucket[0] += red;
      bucket[1] += green;
      bucket[2] += blue;
      bucket[3] += 1;
      buckets.set(key, bucket);
    };
    for (let x = 0; x < width; x += 1) {
      visit(x, 0);
      if (height > 1) visit(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
      visit(0, y);
      if (width > 1) visit(width - 1, y);
    }
    if (!buckets.size) return "#ffffff";
    const winner = [...buckets.values()].sort((a, b) => b[3] - a[3])[0];
    return colorHex([winner[0] / winner[3], winner[1] / winner[3], winner[2] / winner[3]]);
  }

  function removeEdgeBackground(data, width, height, backgroundColor, tolerance = 48) {
    const output = new Uint8ClampedArray(data);
    const target = backgroundColor.map(Number);
    const maximumDistance = Math.max(0, Number(tolerance)) ** 2;
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;

    const matches = (pixel) => {
      const offset = pixel * 4;
      if (output[offset + 3] === 0) return true;
      return colorDistance([output[offset], output[offset + 1], output[offset + 2]], target) <= maximumDistance;
    };
    const enqueue = (pixel) => {
      if (visited[pixel] || !matches(pixel)) return;
      visited[pixel] = 1;
      queue[tail++] = pixel;
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      output[pixel * 4 + 3] = 0;
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < width) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y + 1 < height) enqueue(pixel + width);
    }
    return output;
  }

  function uniquePalette(data, alphaThreshold) {
    const colors = new Map();
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < alphaThreshold) continue;
      const key = `${data[index]},${data[index + 1]},${data[index + 2]}`;
      colors.set(key, (colors.get(key) || 0) + 1);
      if (colors.size > 64) return null;
    }
    return [...colors.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key.split(",").map(Number));
  }

  function dominantFlatPalette(data, alphaThreshold, maximumColors) {
    const counts = new Map();
    let opaqueCount = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < alphaThreshold) continue;
      const key = `${data[index]},${data[index + 1]},${data[index + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      opaqueCount += 1;
    }
    const minimumCount = Math.max(2, opaqueCount * 0.0005);
    const chosen = [];
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, count] of ranked) {
      if (count < minimumCount) break;
      const color = key.split(",").map(Number);
      if (!chosen.length || chosen.every((candidate) => colorDistance(color, candidate) > 28 * 28)) {
        chosen.push(color);
        if (chosen.length === maximumColors) break;
      }
    }
    if (!chosen.length) return null;

    const sample = samplePixels(data, alphaThreshold);
    // Antialiasing creates intermediate edge shades even in genuinely flat art.
    // A wider tolerance keeps the original fill colors instead of averaging them.
    const explained = sample.filter((pixel) => Math.min(...chosen.map((color) => colorDistance(pixel, color))) <= 80 * 80).length;
    return explained / sample.length >= 0.96 ? chosen : null;
  }

  function samplePixels(data, alphaThreshold, maximum = 24000) {
    let opaqueCount = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] >= alphaThreshold) opaqueCount += 1;
    const stride = Math.max(1, Math.ceil(opaqueCount / maximum));
    const sample = [];
    let seen = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < alphaThreshold) continue;
      if (seen % stride === 0) sample.push([data[index], data[index + 1], data[index + 2]]);
      seen += 1;
    }
    return sample;
  }

  function initializeCenters(sample, count) {
    const sorted = [...sample].sort((a, b) => luminance(a) - luminance(b));
    const centers = [sorted[0]];
    if (count > 1) centers.push(sorted[sorted.length - 1]);
    while (centers.length < count) {
      let best = sample[0];
      let bestDistance = -1;
      for (const pixel of sample) {
        const nearest = Math.min(...centers.map((center) => colorDistance(pixel, center)));
        if (nearest > bestDistance) {
          bestDistance = nearest;
          best = pixel;
        }
      }
      centers.push(best);
    }
    return centers.map((center) => [...center]);
  }

  function nearestCenter(pixel, centers) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    centers.forEach((center, index) => {
      const distance = colorDistance(pixel, center);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function assignFlatArtworkLabels(data, width, height, centers, alphaThreshold) {
    const labels = new Int16Array(width * height);
    const confident = new Uint8Array(width * height);
    labels.fill(-1);

    // Exact flat fills remain fixed. Blended antialias pixels are resolved from
    // nearby fixed regions instead of becoming a fringe of an unrelated color.
    const confidenceDistance = 12 * 12;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      if (data[offset + 3] < alphaThreshold) continue;
      const source = [data[offset], data[offset + 1], data[offset + 2]];
      const label = nearestCenter(source, centers);
      labels[pixel] = label;
      confident[pixel] = colorDistance(source, centers[label]) <= confidenceDistance ? 1 : 0;
    }

    const radius = 3;
    for (let pixel = 0; pixel < labels.length; pixel += 1) {
      if (labels[pixel] < 0 || confident[pixel]) continue;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const scores = new Float64Array(centers.length);
      for (let dy = -radius; dy <= radius; dy += 1) {
        const neighborY = y + dy;
        if (neighborY < 0 || neighborY >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const neighborX = x + dx;
          if (neighborX < 0 || neighborX >= width || (!dx && !dy)) continue;
          const neighbor = neighborY * width + neighborX;
          if (!confident[neighbor] || labels[neighbor] < 0) continue;
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          scores[labels[neighbor]] += radius + 1 - distance;
        }
      }
      const bestScore = Math.max(...scores);
      if (bestScore <= 0) continue;
      const candidates = [];
      scores.forEach((score, label) => {
        if (score === bestScore) candidates.push(label);
      });
      if (candidates.length === 1) {
        labels[pixel] = candidates[0];
      } else {
        const offset = pixel * 4;
        const source = [data[offset], data[offset + 1], data[offset + 2]];
        labels[pixel] = candidates.reduce((best, label) => (
          colorDistance(source, centers[label]) < colorDistance(source, centers[best]) ? label : best
        ));
      }
    }
    return labels;
  }

  function quantize(data, width, height, maximumColors = 4, alphaThreshold = 24) {
    const sample = samplePixels(data, alphaThreshold);
    if (!sample.length) throw new Error("The PNG is fully transparent.");
    const flat = dominantFlatPalette(data, alphaThreshold, maximumColors);
    const exact = uniquePalette(data, alphaThreshold);
    let centers;
    if (flat) {
      centers = flat;
    } else if (exact && exact.length <= maximumColors) {
      centers = exact;
    } else {
      const colorCount = Math.min(maximumColors, new Set(sample.map((pixel) => pixel.join(","))).size);
      centers = initializeCenters(sample, colorCount);
      for (let iteration = 0; iteration < 14; iteration += 1) {
        const sums = centers.map(() => [0, 0, 0, 0]);
        for (const pixel of sample) {
          const group = nearestCenter(pixel, centers);
          sums[group][0] += pixel[0];
          sums[group][1] += pixel[1];
          sums[group][2] += pixel[2];
          sums[group][3] += 1;
        }
        centers = centers.map((center, index) => {
          const sum = sums[index];
          return sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] : center;
        });
      }
    }

    centers.sort((a, b) => luminance(a) - luminance(b));
    let labels;
    if (flat) {
      labels = assignFlatArtworkLabels(data, width, height, centers, alphaThreshold);
    } else {
      labels = new Int16Array(width * height);
      labels.fill(-1);
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        const offset = pixel * 4;
        if (data[offset + 3] < alphaThreshold) continue;
        labels[pixel] = nearestCenter([data[offset], data[offset + 1], data[offset + 2]], centers);
      }
    }
    return { labels, palette: centers.map((center) => colorHex(center)) };
  }

  function suggestLuminanceThresholds(data, alphaThreshold = 24) {
    const histogram = new Uint32Array(256);
    let opaqueCount = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < alphaThreshold) continue;
      const value = Math.max(0, Math.min(255, Math.round(luminance([data[index], data[index + 1], data[index + 2]]))));
      histogram[value] += 1;
      opaqueCount += 1;
    }
    if (!opaqueCount) throw new Error("The PNG is fully transparent.");

    let centers = [32, 96, 160, 224];
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const sums = centers.map(() => [0, 0]);
      for (let value = 0; value < histogram.length; value += 1) {
        if (!histogram[value]) continue;
        let group = 0;
        let bestDistance = Infinity;
        centers.forEach((center, index) => {
          const distance = Math.abs(value - center);
          if (distance < bestDistance) {
            bestDistance = distance;
            group = index;
          }
        });
        sums[group][0] += value * histogram[value];
        sums[group][1] += histogram[value];
      }
      centers = centers.map((center, index) => sums[index][1] ? sums[index][0] / sums[index][1] : center);
      centers.sort((a, b) => a - b);
    }
    const thresholds = [0, 1, 2].map((index) => Math.round((centers[index] + centers[index + 1]) / 2));
    thresholds[0] = Math.max(1, Math.min(253, thresholds[0]));
    thresholds[1] = Math.max(thresholds[0] + 1, Math.min(254, thresholds[1]));
    thresholds[2] = Math.max(thresholds[1] + 1, Math.min(255, thresholds[2]));
    return thresholds;
  }

  function quantizeByLuminanceThresholds(data, width, height, thresholds, alphaThreshold = 24) {
    if (!Array.isArray(thresholds) || thresholds.length !== 3) throw new Error("Three thresholds are required.");
    const limits = thresholds.map(Number);
    if (!(limits[0] < limits[1] && limits[1] < limits[2])) throw new Error("Thresholds must be in ascending order.");

    const sums = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    const sourceBands = new Int8Array(width * height);
    sourceBands.fill(-1);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      if (data[offset + 3] < alphaThreshold) continue;
      const value = luminance([data[offset], data[offset + 1], data[offset + 2]]);
      const band = value < limits[0] ? 0 : value < limits[1] ? 1 : value < limits[2] ? 2 : 3;
      sourceBands[pixel] = band;
      sums[band][0] += data[offset];
      sums[band][1] += data[offset + 1];
      sums[band][2] += data[offset + 2];
      sums[band][3] += 1;
    }

    const bandMap = new Int8Array(4);
    bandMap.fill(-1);
    const palette = [];
    sums.forEach((sum, band) => {
      if (!sum[3]) return;
      bandMap[band] = palette.length;
      palette.push(colorHex([sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]));
    });
    if (!palette.length) throw new Error("The PNG is fully transparent.");

    const labels = new Int16Array(width * height);
    labels.fill(-1);
    for (let pixel = 0; pixel < sourceBands.length; pixel += 1) {
      if (sourceBands[pixel] >= 0) labels[pixel] = bandMap[sourceBands[pixel]];
    }
    return { labels, palette };
  }

  function pathsFromLabels(labels, width, height, colorCount) {
    const fragments = Array.from({ length: colorCount }, () => []);
    let active = Array.from({ length: colorCount }, () => new Map());
    for (let y = 0; y < height; y += 1) {
      const rowRuns = Array.from({ length: colorCount }, () => []);
      let x = 0;
      while (x < width) {
        const color = labels[y * width + x];
        if (color < 0) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < width && labels[y * width + x] === color) x += 1;
        rowRuns[color].push({ x: start, width: x - start });
      }
      const nextActive = Array.from({ length: colorCount }, () => new Map());
      for (let color = 0; color < colorCount; color += 1) {
        for (const run of rowRuns[color]) {
          const key = `${run.x}:${run.width}`;
          const rectangle = active[color].get(key) || { x: run.x, y, width: run.width, height: 0 };
          rectangle.height += 1;
          nextActive[color].set(key, rectangle);
        }
        for (const [key, rectangle] of active[color]) {
          if (!nextActive[color].has(key)) fragments[color].push(rectangle);
        }
      }
      active = nextActive;
    }
    for (let color = 0; color < colorCount; color += 1) fragments[color].push(...active[color].values());
    return fragments.map((rectangles) => rectangles.map((rect) => `M${rect.x} ${rect.y}h${rect.width}v${rect.height}h-${rect.width}z`).join(""));
  }

  function mirrorLabelsHorizontally(labels, width, height) {
    const mirrored = new Int16Array(labels.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        mirrored[y * width + x] = labels[y * width + (width - 1 - x)];
      }
    }
    return mirrored;
  }

  function colorSlots(colorCount) {
    if (colorCount <= 1) return [4];
    return [...Array(colorCount - 1)].map((_, index) => index + 1).concat(4);
  }

  function buildSvg(paths, palette, width, height, placement = {}, viewBoxSize = 100) {
    const scalePercent = Number.isFinite(Number(placement.scale)) ? Number(placement.scale) : 100;
    const positionX = Number.isFinite(Number(placement.x)) ? Number(placement.x) : 0;
    const positionY = Number.isFinite(Number(placement.y)) ? Number(placement.y) : 0;
    const rotation = Number.isFinite(Number(placement.rotation)) ? Number(placement.rotation) : 0;
    const scale = (100 / Math.max(width, height)) * (scalePercent / 100);
    const transform = `translate(${(50 + positionX).toFixed(8)} ${(50 + positionY).toFixed(8)}) rotate(${rotation.toFixed(4)}) scale(${scale.toFixed(10)}) translate(${(-width / 2).toFixed(8)} ${(-height / 2).toFixed(8)})`;
    const safeViewBoxSize = Number.isFinite(Number(viewBoxSize)) && Number(viewBoxSize) > 0 ? Number(viewBoxSize) : 100;
    const viewBoxOrigin = (100 - safeViewBoxSize) / 2;
    const defaultViewBox = Math.abs(safeViewBoxSize - 100) < 1e-9;
    const viewBox = defaultViewBox
      ? "0 0 100 100"
      : `${viewBoxOrigin.toFixed(8)} ${viewBoxOrigin.toFixed(8)} ${safeViewBoxSize.toFixed(8)} ${safeViewBoxSize.toFixed(8)}`;
    const slots = colorSlots(paths.length);
    const groups = paths.map((path, index) => `<g id="color_${slots[index]}" fill="${palette[index]}" transform="${transform}"><path d="${path}"/></g>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="${viewBox}" overflow="visible">${groups}</svg>`;
  }

  function buildMakerWorldSvg(paths, palette, width, height, placement = {}) {
    const scalePercent = Number.isFinite(Number(placement.scale)) ? Number(placement.scale) : 100;
    const positionX = Number.isFinite(Number(placement.x)) ? Number(placement.x) : 0;
    const positionY = Number.isFinite(Number(placement.y)) ? Number(placement.y) : 0;
    const rotation = Number.isFinite(Number(placement.rotation)) ? Number(placement.rotation) : 0;
    const scale = (100 / Math.max(width, height)) * (scalePercent / 100);
    const transform = `translate(${(50 + positionX).toFixed(8)} ${(50 + positionY).toFixed(8)}) rotate(${rotation.toFixed(4)}) scale(${scale.toFixed(10)}) translate(${(-width / 2).toFixed(8)} ${(-height / 2).toFixed(8)})`;
    const slots = colorSlots(paths.length);
    const cells = paths.map((path, index) => {
      const cellX = (slots[index] - 1) * 100;
      return `<g transform="translate(${cellX} 0)"><g fill="${palette[index]}" transform="${transform}"><path d="${path}"/></g></g>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="400mm" height="100mm" viewBox="0 0 400 100">${cells}</svg>`;
  }

  global.AMSConverterCore = {
    buildMakerWorldSvg,
    buildSvg,
    colorSlots,
    detectEdgeColor,
    mirrorLabelsHorizontally,
    pathsFromLabels,
    quantize,
    quantizeByLuminanceThresholds,
    removeEdgeBackground,
    suggestLuminanceThresholds,
  };
})(typeof globalThis === "undefined" ? window : globalThis);
