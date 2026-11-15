"use strict";

// Fictional profiles for the simulator. Values are consistent within this case.
const hardwareProfiles = {
  motherboard: {
    am5: { label: "AM5 · DDR5 · M.2 NVMe", socket: "AM5", memory: "DDR5", storage: ["NVMe"], m2Lengths: [80] },
    lga1700: { label: "LGA1700 · DDR4 · M.2 NVMe/SATA", socket: "LGA1700", memory: "DDR4", storage: ["NVMe", "SATA"], m2Lengths: [80] },
  },
  cpu: {
    am5: { label: "AM5 · 105 W", socket: "AM5", watts: 105 },
    lga1700: { label: "LGA1700 · 125 W", socket: "LGA1700", watts: 125 },
  },
  ram: {
    ddr5: { label: "DDR5", memory: "DDR5" },
    ddr4: { label: "DDR4", memory: "DDR4" },
  },
  gpu: {
    standard: { label: "270 mm · 2-slot · 220 W", length: 270, width: 2, watts: 220 },
    long: { label: "330 mm · 2-slot · 260 W", length: 330, width: 2, watts: 260 },
    wide: { label: "290 mm · 4-slot · 300 W", length: 290, width: 4, watts: 300 },
  },
  psu: {
    standard: { label: "650 W · ATX, EPS, PCIe", watts: 650, connectors: ["ATX", "EPS", "PCIe"] },
    low: { label: "350 W · ATX, EPS, PCIe", watts: 350, connectors: ["ATX", "EPS", "PCIe"] },
    noPcie: { label: "550 W · ATX, EPS", watts: 550, connectors: ["ATX", "EPS"] },
  },
  storage: {
    nvme: { label: "M.2 2280 NVMe SSD", interface: "NVMe", length: 80 },
    sata: { label: "M.2 2280 SATA SSD", interface: "SATA", length: 80 },
    long: { label: "M.2 22110 NVMe SSD", interface: "NVMe", length: 110 },
  },
};

const caseLimits = { gpuLength: 340, frontFanDepth: 25, gpuWidth: 3 };
const baseSystemWatts = 75;
const powerHeadroom = 0.20;

function checkBuild(hardware, installed, loose = new Map()) {
  const { motherboard, cpu, ram, gpu, psu, storage } = hardware;
  const checks = [];
  function check(label, passed, success, failure, state = "fail") {
    checks.push({ label, state: passed ? "pass" : state, message: passed ? success : failure });
  }

  check("CPU socket", cpu.socket === motherboard.socket,
    cpu.socket + " CPU matches the motherboard.",
    "The CPU uses " + cpu.socket + ", but the motherboard requires " + motherboard.socket + ".");
  check("RAM type", ram.memory === motherboard.memory,
    ram.memory + " RAM matches the motherboard.",
    "The RAM is " + ram.memory + ", but the motherboard requires " + motherboard.memory + ".");

  const frontFanPresent = installed.has("frontFan") || loose.has("frontFan");
  const gpuLengthLimit = caseLimits.gpuLength - (frontFanPresent ? caseLimits.frontFanDepth : 0);
  const clearance = gpuLengthLimit + " mm and " + caseLimits.gpuWidth + " slots available"
    + (frontFanPresent ? " with the front fan seated." : ".");
  check("GPU clearance", gpu.length <= gpuLengthLimit && gpu.width <= caseLimits.gpuWidth,
    gpu.length + " mm, " + gpu.width + "-slot GPU fits. " + clearance,
    gpu.length + " mm, " + gpu.width + "-slot GPU exceeds the case clearance. " + clearance);

  const load = cpu.watts + gpu.watts + baseSystemWatts;
  const requiredWatts = Math.ceil(load * (1 + powerHeadroom));
  check("PSU wattage", psu.watts >= requiredWatts,
    psu.watts + " W covers the " + requiredWatts + " W target (including 20% headroom).",
    psu.watts + " W is below the " + requiredWatts + " W target (" + load + " W estimated load plus 20% headroom).");
  const missingConnectors = ["ATX", "EPS", "PCIe"].filter(type => !psu.connectors.includes(type));
  check("PSU connectors", missingConnectors.length === 0,
    "The PSU supplies ATX, EPS, and PCIe power.",
    "The PSU lacks the required " + missingConnectors.join(", ") + " power connector.");

  const storageIssues = [];
  if (!motherboard.storage.includes(storage.interface)) {
    storageIssues.push(storage.interface + " is unsupported by this motherboard’s M.2 slot.");
  }
  if (!motherboard.m2Lengths.includes(storage.length)) {
    storageIssues.push("The drive is " + storage.length + " mm long. The slot supports "
      + motherboard.m2Lengths.join(" or ") + " mm.");
  }
  check("Storage fit", storageIssues.length === 0, storage.label + " fits the motherboard’s M.2 slot.",
    storageIssues.join(" "));

  const looseLabels = [...loose.values()];
  check("Mounting screws", looseLabels.length === 0, "All seated parts that need screws are secured.",
    "Tighten the remaining screws for " + looseLabels.join(", ") + ".", "pending");

  const requiredParts = {
    motherboard: "motherboard", cpu: "CPU", ram: "RAM",
    gpu: "graphics card", psu: "power supply", storage: "boot SSD",
  };
  const missingParts = Object.entries(requiredParts).filter(([id]) => !installed.has(id)).map(([, label]) => label);
  check("Installed hardware", missingParts.length === 0, "All required parts are installed.",
    "Install the following parts: " + missingParts.join(", ") + ".", "pending");

  const requiredConnections = { boardPower: "24-pin ATX", cpuPower: "8-pin EPS", gpuPower: "GPU PCIe power" };
  if (frontFanPresent) requiredConnections.frontFanLead = "front fan lead";
  if (installed.has("rearFan")) requiredConnections.rearFanLead = "rear fan lead";
  const missingConnections = Object.entries(requiredConnections).filter(([id]) => !installed.has(id)).map(([, label]) => label);
  check("Essential connections", missingConnections.length === 0, "All required power cables and installed fan leads are connected.",
    "Connect the following: " + missingConnections.join(", ") + ".", "pending");

  const state = checks.some(item => item.state === "fail") ? "invalid"
    : checks.some(item => item.state === "pending") ? "incomplete" : "valid";
  return { state, checks };
}

function setupCompatibility(installed, loose) {
  const form = document.querySelector(".hardware-options");
  const summary = document.querySelector("#compatibility-summary");
  const list = document.querySelector("#compatibility-checks");
  const labels = { valid: "Valid build", incomplete: "Build incomplete", invalid: "Invalid build" };

  for (const select of form.querySelectorAll("select")) {
    for (const [id, profile] of Object.entries(hardwareProfiles[select.name])) {
      select.add(new Option(profile.label, id));
    }
  }

  const selectors = [...form.querySelectorAll("select")];
  const readProfiles = () => Object.fromEntries(selectors.map(select => [select.name, select.value]));

  function readHardware() {
    return Object.fromEntries(selectors.map(select => [select.name, hardwareProfiles[select.name][select.value]]));
  }

  function restoreProfiles(profiles) {
    for (const select of selectors) select.value = profiles[select.name];
    refresh();
  }

  function refresh() {
    const report = checkBuild(readHardware(), installed, loose);
    summary.dataset.state = report.state;
    summary.textContent = labels[report.state];
    list.replaceChildren(...report.checks.map(({ label, state, message }) => {
      const item = document.createElement("li");
      item.dataset.state = state;
      const heading = document.createElement("strong");
      const result = { pass: "Pass", fail: "Issue", pending: "Missing" };
      heading.textContent = label + " · " + result[state];
      const detail = document.createElement("span");
      detail.textContent = message;
      item.append(heading, detail);
      return item;
    }));
  }

  form.addEventListener("change", refresh);
  refresh();
  return { refresh, readHardware, readProfiles, restoreProfiles };
}
