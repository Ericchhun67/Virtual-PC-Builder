"use strict";

const canvas = document.querySelector("canvas");
const errorMessage = document.querySelector(".viewer-error");
const gl = canvas.getContext("webgl", { antialias: true });

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram() {
  const vertexShader = compileShader(gl.VERTEX_SHADER, `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec3 color;
    uniform vec3 right;
    uniform vec3 up;
    uniform vec3 outward;
    uniform vec3 projection;
    varying mediump vec3 shadedColor;

    void main() {
      float depth = projection.z - dot(position, outward);
      gl_Position = vec4(
        dot(position, right) * projection.x,
        dot(position, up) * projection.y,
        1.004 * depth - 0.2004,
        depth
      );
      vec3 keyLight = normalize(vec3(1.0, 1.5, 0.8));
      vec3 fillLight = normalize(vec3(-0.8, 0.2, -1.0));
      float light = 0.56 + 0.46 * max(dot(normal, keyLight), 0.0)
                         + 0.28 * max(dot(normal, fillLight), 0.0);
      shadedColor = color * (length(normal) == 0.0 ? 1.0 : light);
    }
  `);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying mediump vec3 shadedColor;

    void main() {
      gl_FragColor = vec4(shadedColor, 1.0);
    }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

// Each slot shares its center with the corresponding piece of geometry.
const slots = {
  motherboard: { label: "Motherboard", center: [-0.61, 0.17, -0.12] },
  cpu: { label: "CPU", requires: ["motherboard"], center: [-0.53, 0.53, -0.42] },
  frontFan: { label: "Front case fan", center: [0, 0.59, 0.89] },
  rearFan: { label: "Rear case fan", center: [0, 0.58, -0.89] },
  psu: { label: "Power supply", center: [0, -0.90, -0.65] },
  ram: { label: "RAM", requires: ["motherboard"], center: [-0.44, 0.31, 0.40] },
  storage: { label: "M.2 SSD", requires: ["motherboard"], center: [-0.53, -0.16, -0.12] },
  gpu: { label: "Graphics card", requires: ["motherboard"], center: [-0.57, -0.31, -0.34] },
  boardPower: { label: "24-pin motherboard power", requires: ["psu", "motherboard"], center: [-0.52, -0.04, 0.66] },
  cpuPower: { label: "8-pin CPU power", requires: ["psu", "motherboard"], center: [-0.52, 0.87, -0.65] },
  gpuPower: { label: "8-pin GPU power", requires: ["psu", "gpu"], center: [0.17, -0.23, 0.16] },
  frontFanLead: { label: "Front fan lead", requires: ["frontFan", "motherboard"], center: [-0.52, 0.70, 0.66] },
  rearFanLead: { label: "Rear fan lead", requires: ["rearFan", "motherboard"], center: [-0.52, 0.13, -0.79] },
};

const fastenerLabels = ["Top left", "Top right", "Bottom left", "Bottom right"];

function cornerScrews([x, y, z], halfWidth, halfHeight) {
  return fastenerLabels.map((label, index) => ({
    label,
    position: [x + (index % 2 === 0 ? -halfWidth : halfWidth),
      y + (index < 2 ? halfHeight : -halfHeight), z],
    axis: 2,
  }));
}

const fasteners = {
  frontFan: cornerScrews([0, 0.59, 0.785], 0.29, 0.29),
  rearFan: cornerScrews([0, 0.58, -0.785], 0.29, 0.29),
  storage: [{ label: "M.2 retaining screw", position: [-0.518, -0.16, 0.026], axis: 0 }],
  psu: cornerScrews([0, -0.90, -1.005], 0.47, 0.20),
};

function unmetRequirement(part, installed) {
  return slots[part].requires?.find(requirement => !installed.has(requirement));
}

function placementError(part, slot, installed, loose = new Map()) {
  if (!part || !Object.hasOwn(slots, part)) return "Select a component first.";
  if (installed.has(part)) return slots[part].label + " is already installed.";
  if (loose.has(part)) return "Tighten the screws for " + slots[part].label + ".";
  const missing = unmetRequirement(part, installed);
  if (missing) return loose.has(missing)
    ? "Tighten the screws for " + slots[missing].label + " first."
    : "Install " + slots[missing].label + " first.";
  if (slot !== part) return slots[part].label + " must go in its matching slot.";
  return "";
}

function buildGeometry() {
  const vertices = [];
  const chassisBoxes = [];
  let buildingChassis = true;
  const steel = [0.40, 0.49, 0.55];
  const frame = [0.59, 0.68, 0.72];
  const dark = [0.22, 0.29, 0.34];
  const mint = [0.40, 0.90, 0.76];

  function box(x, y, z, width, height, depth, color) {
    const l = x - width / 2;
    const r = x + width / 2;
    const b = y - height / 2;
    const t = y + height / 2;
    const n = z - depth / 2;
    const f = z + depth / 2;
    if (buildingChassis) chassisBoxes.push([[l, b, n], [r, t, f]]);
    const faces = [
      [[1, 0, 0], [[r, b, n], [r, t, n], [r, t, f], [r, b, f]]],
      [[-1, 0, 0], [[l, b, f], [l, t, f], [l, t, n], [l, b, n]]],
      [[0, 1, 0], [[l, t, n], [l, t, f], [r, t, f], [r, t, n]]],
      [[0, -1, 0], [[l, b, f], [l, b, n], [r, b, n], [r, b, f]]],
      [[0, 0, 1], [[r, b, f], [r, t, f], [l, t, f], [l, b, f]]],
      [[0, 0, -1], [[l, b, n], [l, t, n], [r, t, n], [r, b, n]]],
    ];
    for (const [normal, corners] of faces) {
      for (const index of [0, 1, 2, 0, 2, 3]) {
        vertices.push(...corners[index], ...normal, ...color);
      }
    }
  }

  // Positive X is the open side. The opposite wall doubles as the tray.
  box(-0.74, 0, 0, 0.08, 2.35, 2.13, steel);
  box(0, -1.21, 0, 1.56, 0.10, 2.18, steel);
  for (const x of [-0.74, 0.74]) {
    box(x, 1.19, 0, 0.10, 0.11, 2.20, frame);
    for (const z of [-1.045, 1.045]) {
      box(x, -0.035, z, 0.10, 2.34, 0.11, frame);
      box(x * 0.81, -1.32, z * 0.81, 0.24, 0.13, 0.31, dark);
    }
  }
  box(0.74, -1.13, 0, 0.10, 0.10, 2.20, frame);

  // Vent gaps are open so the interior stays visible from the top and front.
  for (let z = -0.96; z <= 1.05; z += 0.16) {
    box(0, 1.19, z, 1.38, 0.09, 0.074, steel);
  }
  for (let y = -1.04; y <= 1.05; y += 0.16) {
    box(0, y, 1.045, 1.38, 0.073, 0.11, steel);
  }
  box(0, 1.19, 1.045, 1.38, 0.11, 0.11, frame);
  box(0.36, 1.20, 1.113, 0.21, 0.026, 0.029, mint);

  // Leave an opening at the back for the PSU inlet and rear fan.
  for (const x of [-0.61, 0.61]) {
    box(x, -0.91, -1.045, 0.16, 0.52, 0.09, steel);
  }
  box(0, -0.57, -1.045, 1.38, 0.15, 0.09, steel);
  box(0, 1.005, -1.045, 1.38, 0.16, 0.09, steel);
  box(-0.56, 0.09, -1.045, 0.27, 1.24, 0.09, steel);
  for (let y = -0.40; y <= 0.22; y += 0.14) {
    box(0.22, y, -1.045, 0.94, 0.063, 0.09, steel);
  }
  for (const y of [-0.53, 0.27, 0.77]) {
    for (const z of [-0.67, 0.17, 0.72]) {
      box(-0.686, y, z, 0.028, 0.056, 0.056, frame);
    }
  }

  const caseVertexCount = vertices.length / 9;
  buildingChassis = false;
  const grid = [0.19, 0.26, 0.32];
  for (let i = -12; i <= 12; i++) {
    const line = i * 0.42;
    for (const point of [[-5.04, -1.39, line], [5.04, -1.39, line],
                         [line, -1.39, -5.04], [line, -1.39, 5.04]]) {
      vertices.push(...point, 0, 0, 0, ...grid);
    }
  }
  const gridVertexCount = vertices.length / 9 - caseVertexCount;
  function partRange(build) {
    const start = vertices.length / 9;
    build();
    return { start, count: vertices.length / 9 - start };
  }

  function caseFan([x, y, z], bladeColor) {
    for (const offset of [-0.29, 0.29]) {
      box(x, y + offset, z, 0.66, 0.08, 0.20, dark);
      box(x + offset, y, z, 0.08, 0.50, 0.20, dark);
    }
    box(x, y, z, 0.17, 0.17, 0.11, steel);
    for (const direction of [-1, 1]) {
      for (let blade = 0; blade < 5; blade++) {
        const angle = blade * 2 * Math.PI / 5;
        for (const [radius, sweep] of [[0.06, 0], [0.245, 0.30], [0.22, 0.79]]) {
          vertices.push(x + radius * Math.cos(angle + sweep), y + radius * Math.sin(angle + sweep),
            z + direction * 0.045, 0, 0, direction, ...bladeColor);
        }
      }
    }
  }

  const cableRoutes = {
    boardPower: {
      color: [0.85, 0.61, 0.27],
      points: [[-0.14, -0.83, -0.29], [-0.14, -0.83, 0.66], [-0.14, -0.04, 0.66]],
    },
    cpuPower: {
      color: [0.60, 0.48, 0.74],
      points: [[-0.38, -0.80, -0.29], [-0.38, -0.80, -0.96], [-0.38, 0.87, -0.96], [-0.38, 0.87, -0.65]],
    },
    gpuPower: {
      color: [0.77, 0.42, 0.33],
      points: [[0.31, -0.85, -0.29], [0.31, -0.85, 0.16], [0.31, -0.23, 0.16]],
    },
    frontFanLead: {
      color: [0.30, 0.70, 0.62],
      points: [[-0.30, 0.78, 0.89], [-0.30, 0.78, 0.66], [-0.30, 0.70, 0.66]],
    },
    rearFanLead: {
      color: [0.42, 0.64, 0.86],
      points: [[-0.30, 0.38, -0.89], [-0.30, 0.13, -0.89], [-0.30, 0.13, -0.79]],
    },
  };

  const parts = {
    frontFan: partRange(() => caseFan(slots.frontFan.center, [0.28, 0.68, 0.61])),
    rearFan: partRange(() => caseFan(slots.rearFan.center, [0.37, 0.56, 0.76])),
    psu: partRange(() => {
      const [x, y, z] = slots.psu.center;
      box(x, y, z, 1.04, 0.50, 0.69, dark);
      for (const offset of [-0.24, -0.12, 0, 0.12, 0.24]) {
        box(x + offset, y + 0.255, z, 0.045, 0.012, 0.37, steel);
      }
      box(x - 0.27, y, z - 0.351, 0.24, 0.17, 0.022, [0.09, 0.13, 0.17]);
      box(x + 0.23, y, z - 0.351, 0.12, 0.12, 0.022, frame);
    }),
    motherboard: partRange(() => {
      const [, y, z] = slots.motherboard.center;
      box(-0.645, y, z, 0.049, 1.65, 1.64, [0.13, 0.47, 0.38]);
      box(-0.604, 0.53, -0.42, 0.045, 0.51, 0.51, dark);
      box(-0.592, 0.31, 0.40, 0.063, 0.99, 0.12, dark);
      for (const railZ of [0.345, 0.455]) {
        box(-0.556, 0.31, railZ, 0.043, 0.99, 0.022, steel);
      }
      box(-0.604, -0.31, -0.34, 0.063, 0.059, 0.66, frame);
      for (const port of ["boardPower", "cpuPower", "frontFanLead", "rearFanLead"]) {
        const [, portY, portZ] = slots[port].center;
        box(-0.597, portY, portZ, 0.064, 0.065, port === "boardPower" ? 0.18 : 0.09, dark);
      }
      box(-0.609, -0.16, -0.30, 0.045, 0.12, 0.06, dark);
      for (const traceY of [-0.28, -0.42, -0.56]) {
        box(-0.615, traceY, -0.25, 0.01, 0.014, 0.97, [0.73, 0.59, 0.27]);
      }
    }),
    storage: partRange(() => {
      const [, y, z] = slots.storage.center;
      box(-0.563, y, z, 0.041, 0.12, 0.34, [0.30, 0.53, 0.35]);
      for (const chipZ of [-0.20, -0.06]) {
        box(-0.538, y, chipZ, 0.018, 0.083, 0.093, dark);
      }
      box(-0.538, y, 0.026, 0.022, 0.043, 0.039, frame);
    }),
    gpu: partRange(() => {
      const [, y] = slots.gpu.center;
      box(-0.242, y, -0.34, 0.69, 0.047, 1.24, [0.22, 0.30, 0.34]);
      box(-0.19, y - 0.07, -0.33, 0.55, 0.12, 1.15, dark);
      box(-0.18, y - 0.037, -0.974, 0.67, 0.22, 0.045, frame);
      for (const z of [-0.63, -0.27, 0.09]) {
        box(0.088, y - 0.075, z, 0.014, 0.032, 0.24, steel);
      }
      box(0.105, -0.245, 0.16, 0.10, 0.06, 0.14, frame);
    }),
    cpu: partRange(() => {
      const [, y, z] = slots.cpu.center;
      box(-0.552, y, z, 0.053, 0.40, 0.40, [0.68, 0.74, 0.79]);
      box(-0.522, y, z, 0.012, 0.29, 0.29, [0.83, 0.88, 0.90]);
    }),
    ram: partRange(() => {
      const [, y, z] = slots.ram.center;
      box(-0.493, y, z, 0.145, 0.91, 0.067, [0.29, 0.51, 0.74]);
      for (const chipY of [0.00, 0.20, 0.40, 0.60]) {
        box(-0.485, chipY, z + 0.037, 0.089, 0.12, 0.016, dark);
      }
    }),
  };
  for (const [id, { color, points }] of Object.entries(cableRoutes)) {
    parts[id] = partRange(() => {
      const end = slots[id].center;
      const route = [...points, end];
      const thickness = id.endsWith("Lead") ? 0.023 : 0.043;
      for (let index = 1; index < route.length; index++) {
        const previous = route[index - 1];
        const next = route[index];
        const midpoint = next.map((value, axis) => (value + previous[axis]) / 2);
        const size = next.map((value, axis) => Math.abs(value - previous[axis]) + thickness);
        box(...midpoint, ...size, color);
      }
      box(...end, 0.07, 0.07, 0.09, color);
    });
  }
  const screws = Object.fromEntries(Object.entries(fasteners).map(([part, points]) => [
    part,
    points.map(({position, axis}) => partRange(() => {
      const diameter = part === "storage" ? 0.037 : 0.063;
      const head = [diameter, diameter, diameter];
      head[axis] = 0.016;
      box(...position, ...head, frame);
      const face = [...position];
      const direction = part === "frontFan" || part === "psu" ? -1 : 1;
      face[axis] += direction * 0.009;
      for (const crossAxis of [0, 1, 2].filter(value => value !== axis)) {
        const groove = [0.010, 0.010, 0.010];
        groove[axis] = 0.003;
        groove[crossAxis] = diameter * 0.70;
        box(...face, ...groove, dark);
      }
    })),
  ]));
  return { vertices: new Float32Array(vertices), caseVertexCount, gridVertexCount, chassisBoxes, parts, screws };
}

// Clip the eye-to-slot segment against a box to hide markers behind the case.
function blocksSlot(eye, point, [min, max]) {
  let entry = 0;
  let exit = 0.999;
  for (let axis = 0; axis < 3; axis++) {
    const delta = point[axis] - eye[axis];
    if (Math.abs(delta) < 0.000001) {
      if (eye[axis] < min[axis] || eye[axis] > max[axis]) return false;
      continue;
    }
    const a = (min[axis] - eye[axis]) / delta;
    const b = (max[axis] - eye[axis]) / delta;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return false;
  }
  return true;
}

function startViewer(installed, loose, refreshCompatibility) {
  const program = createProgram();
  const { vertices, caseVertexCount, gridVertexCount, chassisBoxes, parts, screws } = buildGeometry();
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  for (const [index, name] of ["position", "normal", "color"].entries()) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 36, index * 12);
  }
  const uniforms = Object.fromEntries(
    ["right", "up", "outward", "projection"].map(name => [name, gl.getUniformLocation(program, name)])
  );
  gl.enable(gl.DEPTH_TEST);

  const initialView = { yaw: 1.36, pitch: 0.34, distance: 6.1 };
  const view = { ...initialView };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const catalog = [...document.querySelectorAll(".part")];
  const targets = [...document.querySelectorAll(".snap-target")];
  const viewport = canvas.parentElement;
  const status = document.querySelector(".assembly-status");
  const fastening = document.querySelector("#fastening");
  const screwGroups = document.querySelector("#screw-groups");
  const catalogByPart = new Map(catalog.map(button => [button.dataset.part, button]));
  const tightened = new Map();
  const screwButtons = new Map();
  let selectedPart = null;
  let draggedPart = null;

  function selectPart(part) {
    selectedPart = part;
    for (const button of catalog) {
      button.setAttribute("aria-pressed", String(button.dataset.part === part));
    }
    const missing = unmetRequirement(part, installed);
    status.textContent = missing
      ? placementError(part, part, installed, loose)
      : "Place " + slots[part].label + " in its matching slot.";
    draw();
  }

  function finishInstall(part) {
    installed.add(part);
    catalogByPart.get(part).querySelector("span").textContent = "Installed";
    status.textContent = installed.size === catalog.length
      ? "Assembly complete. All components are installed."
      : slots[part].label + " installed. Select another component.";
  }

  function showScrews(part) {
    const points = fasteners[part];
    const secured = new Set();
    tightened.set(part, secured);
    const group = document.createElement("fieldset");
    const heading = document.createElement("legend");
    heading.textContent = slots[part].label + " · 0/" + points.length + " tightened";
    group.append(heading);
    const buttons = points.map(({label}, index) => {
      const screw = document.createElement("button");
      screw.type = "button";
      screw.textContent = label;
      screw.setAttribute("aria-label", "Tighten " + slots[part].label + " · " + label);
      screw.addEventListener("click", () => {
        if (secured.has(index)) return;
        secured.add(index);
        screw.disabled = true;
        screw.textContent = label + " ✓";
        screw.setAttribute("aria-label", label + " tightened");
        heading.textContent = slots[part].label + " · " + secured.size + "/" + points.length + " tightened";
        if (secured.size === points.length) {
          loose.delete(part);
          finishInstall(part);
        } else {
          catalogByPart.get(part).querySelector("span").textContent = secured.size + "/" + points.length + " screws tightened";
          status.textContent = slots[part].label + " · " + secured.size + " of " + points.length + " screws tightened.";
        }
        if (document.activeElement === screw) {
          const next = buttons.find(button => !button.disabled)
            || screwGroups.querySelector("button:not(:disabled)")
            || catalog.find(button => !button.disabled) || canvas;
          next.focus();
        }
        refreshCompatibility();
        draw();
      });
      return screw;
    });
    screwButtons.set(part, buttons);
    group.append(...buttons);
    screwGroups.append(group);
    fastening.hidden = false;
    return buttons[0];
  }

  function install(part, slot) {
    const error = placementError(part, slot, installed, loose);
    if (error) {
      status.textContent = error;
      return;
    }
    selectedPart = null;
    const button = catalogByPart.get(part);
    button.disabled = true;
    button.draggable = false;
    button.setAttribute("aria-pressed", "false");
    let firstScrew;
    if (Object.hasOwn(fasteners, part)) {
      loose.set(part, slots[part].label);
      button.querySelector("span").textContent = "Seated · screws required";
      firstScrew = showScrews(part);
      status.textContent = slots[part].label + " seated. Tighten the screws below.";
    } else {
      finishInstall(part);
    }
    if (document.activeElement === targets.find(item => item.dataset.slot === slot)) {
      (firstScrew || catalog.find(item => !item.disabled) || canvas).focus();
    }
    refreshCompatibility();
    draw();
  }

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function updateTargets(right, up, outward, scaleX, scaleY) {
    const eye = outward.map(value => value * view.distance);
    for (const target of targets) {
      const slot = target.dataset.slot;
      const point = slots[slot].center;
      const depth = view.distance - dot(point, outward);
      const x = dot(point, right) * scaleX / depth;
      const y = dot(point, up) * scaleY / depth;
      target.hidden = installed.has(slot) || loose.has(slot) || unmetRequirement(slot, installed)
        || eye[0] <= point[0] || Math.abs(x) > 0.96 || Math.abs(y) > 0.94
        || chassisBoxes.some(box => blocksSlot(eye, point, box));
      target.style.zIndex = selectedPart === slot ? "1" : "";
      target.style.left = (x + 1) * 50 + "%";
      target.style.top = (1 - y) * 50 + "%";
    }
  }

  function draw() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const sy = Math.sin(view.yaw);
    const cy = Math.cos(view.yaw);
    const sp = Math.sin(view.pitch);
    const cp = Math.cos(view.pitch);
    const aspect = width / height;
    const focalLength = 2.42;
    const right = [cy, 0, -sy];
    const up = [-sy * sp, cp, -cy * sp];
    const outward = [sy * cp, sp, cy * cp];
    const scaleX = focalLength / Math.max(1, aspect);
    const scaleY = focalLength * Math.min(1, aspect);
    gl.uniform3f(uniforms.right, ...right);
    gl.uniform3f(uniforms.up, ...up);
    gl.uniform3f(uniforms.outward, ...outward);
    gl.uniform3f(uniforms.projection, scaleX, scaleY, view.distance);

    gl.drawArrays(gl.LINES, caseVertexCount, gridVertexCount);
    gl.drawArrays(gl.TRIANGLES, 0, caseVertexCount);
    for (const part of [...installed, ...loose.keys()]) {
      gl.drawArrays(gl.TRIANGLES, parts[part].start, parts[part].count);
    }
    for (const [part, indices] of tightened) {
      for (const index of indices) {
        const {start, count} = screws[part][index];
        gl.drawArrays(gl.TRIANGLES, start, count);
      }
    }
    updateTargets(right, up, outward, scaleX, scaleY);
  }

  function rotate(dx, dy) {
    view.yaw -= dx * 0.009;
    view.pitch = clamp(view.pitch + dy * 0.009, -1.48, 1.48);
    draw();
  }

  function zoom(factor) {
    view.distance = clamp(view.distance * factor, 2.65, 13);
    draw();
  }

  function reset() {
    Object.assign(view, initialView);
    draw();
  }

  for (const button of catalog) {
    const part = button.dataset.part;
    button.addEventListener("click", () => selectPart(part));
    button.addEventListener("dragstart", event => {
      selectPart(part);
      draggedPart = part;
      event.dataTransfer.setData("text/plain", part);
      event.dataTransfer.effectAllowed = "move";
    });
    button.addEventListener("dragend", () => {
      draggedPart = null;
      for (const target of targets) target.classList.remove("drop-hover");
    });
  }
  for (const target of targets) {
    target.addEventListener("click", () => install(selectedPart, target.dataset.slot));
  }

  viewport.addEventListener("dragover", event => {
    if (!draggedPart) return;
    event.preventDefault();
    const slot = event.target.closest(".snap-target");
    event.dataTransfer.dropEffect = "move";
    for (const target of targets) {
      target.classList.toggle("drop-hover", target === slot && target.dataset.slot === draggedPart);
    }
  });
  viewport.addEventListener("dragleave", event => {
    if (viewport.contains(event.relatedTarget)) return;
    for (const target of targets) target.classList.remove("drop-hover");
  });
  viewport.addEventListener("drop", event => {
    if (!draggedPart) return;
    event.preventDefault();
    const target = event.target.closest(".snap-target");
    install(draggedPart, target && !target.hidden ? target.dataset.slot : null);
  });

  const pointers = new Map();
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || pointers.size >= 2) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, event);
  });
  canvas.addEventListener("pointermove", event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, event);
    if (pointers.size === 1) {
      rotate(event.clientX - previous.clientX, event.clientY - previous.clientY);
      return;
    }
    const [other] = [...pointers.values()].filter(pointer => pointer.pointerId !== event.pointerId);
    const oldGap = Math.hypot(previous.clientX - other.clientX, previous.clientY - other.clientY);
    const newGap = Math.hypot(event.clientX - other.clientX, event.clientY - other.clientY);
    if (oldGap > 0 && newGap > 0) zoom(oldGap / newGap);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, event => pointers.delete(event.pointerId));
  }
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    zoom(Math.exp(clamp(event.deltaY * scale, -150, 150) * 0.0028));
  }, { passive: false });

  const keys = {
    ArrowLeft: () => rotate(-20, 0),
    ArrowRight: () => rotate(20, 0),
    ArrowUp: () => rotate(0, -20),
    ArrowDown: () => rotate(0, 20),
    "+": () => zoom(0.87),
    "=": () => zoom(0.87),
    "-": () => zoom(1 / 0.87),
    Home: reset,
  };
  canvas.addEventListener("keydown", event => {
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    keys[event.key]();
  });
  document.querySelector("#zoom-in").addEventListener("click", () => zoom(0.87));
  document.querySelector("#zoom-out").addEventListener("click", () => zoom(1 / 0.87));
  document.querySelector("#reset").addEventListener("click", reset);
  new ResizeObserver(draw).observe(canvas);
  draw();
  const catalogDescriptions = new Map(catalog.map(button => [button, button.querySelector("span").textContent]));

  function validateAssembly(parts) {
    if (!Array.isArray(parts)) return false;
    const secured = new Set();
    const seen = new Set();
    for (const entry of parts) {
      if (!entry || !Object.hasOwn(slots, entry.id) || seen.has(entry.id)
        || !Array.isArray(entry.screws) || unmetRequirement(entry.id, secured)) return false;
      const count = fasteners[entry.id]?.length ?? 0;
      if (new Set(entry.screws).size !== entry.screws.length
        || entry.screws.some(index => !Number.isInteger(index) || index < 0 || index >= count)) return false;
      seen.add(entry.id);
      if (entry.screws.length === count) secured.add(entry.id);
    }
    return true;
  }

  function restoreAssembly(parts) {
    installed.clear();
    loose.clear();
    tightened.clear();
    screwButtons.clear();
    selectedPart = null;
    screwGroups.replaceChildren();
    fastening.hidden = true;
    for (const button of catalog) {
      button.disabled = false;
      button.draggable = true;
      button.setAttribute("aria-pressed", "false");
      button.querySelector("span").textContent = catalogDescriptions.get(button);
    }
    for (const {id, screws} of parts) {
      install(id, id);
      for (const index of screws) screwButtons.get(id)[index].click();
    }
    status.textContent = "Build loaded.";
    refreshCompatibility();
    reset();
  }

  return {
    snapshot: () => [...installed, ...loose.keys()].map(id => ({id, screws: [...(tightened.get(id) ?? [])]})),
    validateAssembly,
    restoreAssembly,
  };
}

const installedParts = new Set();
const looseParts = new Map();
const compatibility = setupCompatibility(installedParts, looseParts);
const startup = setupStartup(installedParts, compatibility.readHardware, looseParts);
document.querySelector(".hardware-options").addEventListener("change", startup.buildChanged);

if (!gl) {
  showError("WebGL is unavailable. Open the simulator in a browser with WebGL enabled.");
} else {
  try {
    const assembly = startViewer(installedParts, looseParts, () => {
      compatibility.refresh();
      startup.buildChanged();
    });
    setupSavedBuilds(assembly, compatibility, startup);
  } catch (error) {
    console.error(error);
    showError("The 3D viewer could not start.");
  }
}
