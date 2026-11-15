"use strict";

const demoOrder = [
  "motherboard", "cpu", "ram", "gpu", "storage", "psu", "frontFan", "rearFan",
  "boardPower", "cpuPower", "gpuPower", "frontFanLead", "rearFanLead",
];

function setupSavedBuilds(assembly, compatibility, startup) {
  const form = document.querySelector("#save-build");
  const name = document.querySelector("#build-name");
  const loadForm = document.querySelector("#load-build");
  const locator = document.querySelector("#build-locator");
  const demo = document.querySelector("#demo-build");
  const status = document.querySelector("#saved-build-status");
  const link = document.querySelector("#saved-build-link");
  const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  let busy = false;

  function showLink(id) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("build", id);
    else url.searchParams.delete("build");
    window.history.replaceState(null, "", url);
    link.hidden = !id;
    link.href = url.href;
    locator.value = id ?? "";
  }

  function applyBuild(configuration) {
    const {version, profiles, parts, firmware} = configuration ?? {};
    if (version !== 1 || !profiles || !firmware
      || !Object.entries(hardwareProfiles).every(([key, options]) => Object.hasOwn(options, profiles[key]))
      || !validBootOrder(firmware.order) || typeof firmware.usbConnected !== "boolean"
      || !assembly.validateAssembly(parts)) {
      throw new Error("This build contains unsupported settings or placements.");
    }
    startup.buildChanged();
    compatibility.restoreProfiles(profiles);
    startup.firmware.restore(firmware);
    assembly.restoreAssembly(parts);
  }

  async function handleRequest(operation) {
    if (busy) return;
    busy = true;
    status.textContent = "Working…";
    try {
      await operation();
    } catch (error) {
      status.textContent = error instanceof TypeError ? "Could not reach the build server." : error.message;
    } finally {
      busy = false;
    }
  }

  async function requestBuild(path, options) {
    const response = await fetch(path, options);
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(result?.error ?? "The build request failed.");
    return result;
  }

  function load(id) {
    return handleRequest(async () => {
      if (!uuidPattern.test(id)) throw new Error("Enter a saved build ID or link.");
      const build = await requestBuild("/api/builds/" + id);
      applyBuild(build.configuration);
      name.value = build.name;
      showLink(build.id);
      status.textContent = "Loaded " + build.name + ".";
    });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    handleRequest(async () => {
      const configuration = {
        version: 1,
        profiles: compatibility.readProfiles(),
        parts: assembly.snapshot(),
        firmware: startup.firmware.snapshot(),
      };
      const build = await requestBuild("/api/builds", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({name: name.value, configuration}),
      });
      showLink(build.id);
      status.textContent = "Saved " + build.name + ". The build link reopens this snapshot.";
    });
  });

  loadForm.addEventListener("submit", event => {
    event.preventDefault();
    const value = locator.value.trim();
    let id = value;
    try {
      id = new URL(value, window.location.href).searchParams.get("build") || value;
    } catch {
      // Pass malformed links through the same build ID validation.
    }
    load(id);
  });

  demo.addEventListener("click", () => {
    if (busy) return;
    applyBuild({
      version: 1,
      profiles: Object.fromEntries(Object.entries(hardwareProfiles).map(([key, options]) => [key, Object.keys(options)[0]])),
      parts: demoOrder.map(id => ({id, screws: (fasteners[id] ?? []).map((_, index) => index)})),
      firmware: {order: [...defaultBootOrder], usbConnected: false},
    });
    name.value = "Working demo build";
    showLink(null);
    status.textContent = "Demo loaded. Select Power on, then Attempt boot in BIOS.";
  });

  const initialId = new URL(window.location.href).searchParams.get("build");
  if (initialId) load(initialId);
}
