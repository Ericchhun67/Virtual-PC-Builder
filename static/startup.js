"use strict";

function getStartupStages(report, installed) {
  const problems = new Map(
    report.checks.filter(check => check.state !== "pass").map(check => [check.label, check.message])
  );
  const missing = (id, message) => installed.has(id) ? null : message;
  return [
    {
      phase: "powering", code: "PWR-MOUNT", label: "Mounting screws",
      issues: [problems.get("Mounting screws")].filter(Boolean),
    },
    {
      phase: "powering", code: "PWR-01", label: "Power delivery",
      issues: [
        missing("psu", "Install the power supply."),
        missing("motherboard", "Install the motherboard."),
        missing("boardPower", "Connect the 24-pin ATX cable to the motherboard."),
        problems.get("PSU wattage"), problems.get("PSU connectors"),
      ].filter(Boolean),
    },
    {
      phase: "post", code: "POST-CPU", label: "Processor",
      issues: [
        missing("cpu", "Install the CPU in the motherboard socket."),
        missing("cpuPower", "Connect the 8-pin EPS cable to the CPU power header."),
        problems.get("CPU socket"),
      ].filter(Boolean),
    },
    {
      phase: "post", code: "POST-RAM", label: "Memory",
      issues: [
        missing("ram", "Install a RAM module in the DIMM slot."),
        problems.get("RAM type"),
      ].filter(Boolean),
    },
    {
      phase: "post", code: "POST-GPU", label: "Graphics",
      issues: [
        missing("gpu", "Install the graphics card in the PCIe slot."),
        missing("gpuPower", "Connect the 8-pin PCIe cable to the graphics card."),
        problems.get("GPU clearance"),
      ].filter(Boolean),
    },
    {
      phase: "post", code: "POST-SSD", label: "Storage",
      issues: [missing("storage", "Install the M.2 boot SSD."), problems.get("Storage fit")].filter(Boolean),
    },
    {
      phase: "post", code: "POST-FAN", label: "Case fan connections",
      issues: [
        installed.has("frontFan") && missing("frontFanLead", "Connect the front fan lead to its motherboard header."),
        installed.has("rearFan") && missing("rearFanLead", "Connect the rear fan lead to its motherboard header."),
      ].filter(Boolean),
    },
  ];
}

function setupStartup(installed, readHardware, loose) {
  const button = document.querySelector("#pc-power");
  const display = document.querySelector("#startup-display");
  const stateLabel = document.querySelector("#startup-state");
  const detail = document.querySelector("#startup-detail");
  const log = document.querySelector("#startup-log");
  const bios = document.querySelector("#bios-screen");
  const returnToBios = document.querySelector("#return-to-bios");
  const stateNames = {
    off: "Powered off",
    powering: "Powering on",
    post: "Running POST",
    fault: "Startup fault",
    bios: "UEFI / BIOS setup",
    booting: "Booting",
    booted: "Boot successful",
    bootFault: "Boot failed",
  };
  let state = "off";
  let timer;
  let stages = [];
  let stageIndex = 0;
  let hardware;
  const firmware = setupBios(installed, boot);

  function transition(nextState, message) {
    state = nextState;
    display.dataset.state = state;
    stateLabel.textContent = stateNames[state];
    detail.textContent = message;
    button.textContent = state === "off" ? "Power on" : state === "fault" ? "Retry startup" : "Power off";
    bios.hidden = state !== "bios";
    returnToBios.hidden = state !== "bootFault" && state !== "booted";
  }

  function logMessage(message, failed = false) {
    const line = document.createElement("li");
    line.textContent = message;
    if (failed) line.dataset.state = "fault";
    log.append(line);
  }

  function powerOff(message) {
    clearTimeout(timer);
    log.replaceChildren();
    transition("off", message);
  }

  function advance() {
    const stage = stages[stageIndex];
    if (!stage) {
      logMessage("POST passed. Entering BIOS setup.");
      enterBios("POST passed. Review hardware and configure boot priority.");
      return;
    }

    transition(stage.phase, "Checking " + stage.label.toLowerCase() + "…");
    timer = setTimeout(() => {
      if (stage.issues.length) {
        transition("fault", stage.code + " · " + stage.label + " failed. Fix the issues and retry.");
        for (const issue of stage.issues) logMessage(issue, true);
        return;
      }
      logMessage(stage.label + " · OK");
      stageIndex++;
      advance();
    }, 400);
  }

  function enterBios(message) {
    firmware.show(hardware);
    transition("bios", message);
  }

  function boot({ drive, skipped }) {
    if (state !== "bios") return;
    for (const message of skipped) logMessage(message, true);
    if (drive) logMessage("Booting from " + drive.label + "…");
    transition("booting", drive ? "Starting " + drive.label + "…" : "Scanning for a bootable drive…");
    stateLabel.focus();
    timer = setTimeout(() => {
      if (drive) {
        logMessage("Boot complete from " + drive.label + ".");
        transition("booted", "Started " + drive.target + " from " + drive.label + ".");
      } else {
        logMessage("No bootable drive found in the saved priority.", true);
        transition("bootFault", "Connect the selected drive or return to BIOS to change the boot priority.");
      }
    }, 750);
  }

  returnToBios.addEventListener("click", () => {
    enterBios("Review the available drives and saved boot priority.");
    document.querySelector("#bios-heading").focus();
  });

  function powerOn() {
    hardware = readHardware();
    stages = getStartupStages(checkBuild(hardware, installed, loose), installed);
    stageIndex = 0;
    log.replaceChildren();
    advance();
  }

  button.addEventListener("click", () => {
    if (state === "off" || state === "fault") {
      powerOn();
    } else {
      powerOff("Press Power on to run startup checks.");
    }
  });

  return {
    firmware,
    buildChanged() {
      if (state !== "off") powerOff("Build changed. Press Power on to check the current configuration.");
    },
  };
}
