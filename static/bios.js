"use strict";

const bootSettingsKey = "virtualpcbuilder.boot-priority";
const defaultBootOrder = ["ssd", ""];
const bootDevices = { ssd: "Internal M.2 SSD", usb: "Virtual USB installer" };

function validBootOrder(order) {
  return Array.isArray(order) && order.length === 2 && Object.hasOwn(bootDevices, order[0])
    && (order[1] === "" || Object.hasOwn(bootDevices, order[1])) && order[0] !== order[1];
}

function getBootDrives(installed, hardware, usbConnected) {
  return [
    { id: "ssd", label: hardware.storage.label, present: installed.has("storage"), target: "the simulated operating system" },
    { id: "usb", label: bootDevices.usb, present: usbConnected, target: "the simulated USB installer" },
  ];
}

function chooseBootDrive(drives, order) {
  const skipped = [];
  for (const id of order.filter(Boolean)) {
    const drive = drives.find(item => item.id === id && item.present);
    if (drive) return { drive, skipped };
    skipped.push(bootDevices[id] + " is unavailable.");
  }
  return { drive: null, skipped };
}

function setupBios(installed, attemptBoot) {
  const info = document.querySelector("#bios-info");
  const drives = document.querySelector("#bios-drives");
  const form = document.querySelector("#boot-settings");
  const primary = document.querySelector("#boot-primary");
  const fallback = document.querySelector("#boot-fallback");
  const usb = document.querySelector("#bios-usb");
  const status = document.querySelector("#boot-settings-status");
  const bootButton = document.querySelector("#boot-attempt");
  let hardware;
  let saved = [...defaultBootOrder];
  try {
    const stored = JSON.parse(window.localStorage.getItem(bootSettingsKey));
    if (validBootOrder(stored)) saved = stored;
  } catch {
    // Use the default order if browser storage is unavailable or malformed.
  }

  const currentOrder = () => [primary.value, fallback.value];
  const availableDrives = () => getBootDrives(installed, hardware, usb.checked);
  const isDirty = () => currentOrder().some((id, index) => id !== saved[index]);

  function renderDrives() {
    drives.replaceChildren(...availableDrives().map(drive => {
      const row = document.createElement("li");
      row.textContent = drive.label + (drive.present ? " · Bootable" : " · Disconnected");
      return row;
    }));
  }

  function show(nextHardware) {
    hardware = nextHardware;
    const connectedFans = ["frontFanLead", "rearFanLead"].filter(id => installed.has(id)).length;
    const cpuTemp = 35 + Math.round(hardware.cpu.watts / 25) + (2 - connectedFans) * 3;
    const gpuTemp = 32 + Math.round(hardware.gpu.watts / 35) + (2 - connectedFans) * 2;
    info.replaceChildren(...[
      ["Motherboard", hardware.motherboard.label],
      ["CPU", hardware.cpu.label + " · " + cpuTemp + " °C"],
      ["Memory", hardware.ram.label],
      ["GPU", hardware.gpu.label + " · " + gpuTemp + " °C"],
      ["Power supply", hardware.psu.label],
      ["Case fans", connectedFans + " connected"],
    ].flatMap(([label, value]) => {
      const name = document.createElement("dt");
      name.textContent = label;
      const data = document.createElement("dd");
      data.textContent = value;
      return [name, data];
    }));
    [primary.value, fallback.value] = saved;
    status.textContent = "Boot attempts use the saved priority.";
    bootButton.disabled = false;
    renderDrives();
  }

  form.addEventListener("change", () => {
    bootButton.disabled = isDirty();
    status.textContent = isDirty() ? "Save your changes before attempting to boot." : "Boot priority is up to date.";
  });

  usb.addEventListener("change", renderDrives);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const order = currentOrder();
    if (!validBootOrder(order)) {
      status.textContent = "Choose two different drives, or set fallback to Disabled.";
      return;
    }
    saved = order;
    bootButton.disabled = false;
    try {
      window.localStorage.setItem(bootSettingsKey, JSON.stringify(saved));
      status.textContent = "Boot priority saved.";
    } catch {
      status.textContent = "Boot priority saved for this session.";
    }
  });

  bootButton.addEventListener("click", () => {
    if (isDirty() || !hardware) return;
    attemptBoot(chooseBootDrive(availableDrives(), saved));
  });

  return {
    show,
    snapshot: () => ({order: [...saved], usbConnected: usb.checked}),
    restore({order, usbConnected}) {
      saved = [...order];
      usb.checked = usbConnected;
    },
  };
}
