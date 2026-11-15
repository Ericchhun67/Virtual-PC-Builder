"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ids = [
  "motherboard", "cpu", "ram", "frontFan", "rearFan", "psu", "gpu", "storage",
  "boardPower", "cpuPower", "gpuPower", "frontFanLead", "rearFanLead",
];
const profiles = ["motherboard", "cpu", "ram", "gpu", "psu", "storage"];
const scripts = ["compatibility", "bios", "startup", "saved-builds", "viewer"]
  .map(name => fs.readFileSync(path.join(__dirname, "../static", name + ".js"), "utf8")).join("\n");
const savedId = "1a73e2b6-932f-4598-a633-7aaac61a8141";

function element(dataset = {}) {
  return {
    dataset, style: {}, children: [], handlers: new Map(), label: {},
    value: "", disabled: false, checked: false,
    addEventListener(type, fn) {
      if (!this.handlers.has(type)) this.handlers.set(type, []);
      this.handlers.get(type).push(fn);
    },
    trigger(type) {
      for (const fn of this.handlers.get(type) ?? []) fn({preventDefault() {}});
    },
    click() { if (!this.disabled) this.trigger("click"); },
    add(option) { if (!this.value) this.value = option.value; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    querySelector(query) { return query === "span" ? this.label : null; },
    setAttribute() {},
    focus() {},
  };
}

function runApp(records, url = "http://localhost:5000/") {
  const elements = new Map();
  const timers = new Map();
  const catalog = ids.map(part => element({part}));
  const targets = ids.map(slot => element({slot}));
  const selectors = profiles.map(name => Object.assign(element(), {name}));
  const noop = () => {};
  const gl = new Proxy({
    getShaderParameter: () => true, getProgramParameter: () => true,
  }, {get: (object, key) => object[key] ?? noop});
  const canvas = Object.assign(element(), {
    clientWidth: 900, clientHeight: 500, getContext: () => gl, parentElement: element(),
  });
  const form = {...element(), querySelectorAll: () => selectors};
  elements.set("canvas", canvas);
  elements.set(".hardware-options", form);
  let timerId = 0;
  const location = {href: url};
  const find = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };

  vm.runInNewContext(scripts, {
    console, URL, ResizeObserver: class {observe() {}},
    Option: class {constructor(label, value) { this.value = value; }},
    window: {
      devicePixelRatio: 1, location,
      history: {replaceState(_, __, nextUrl) { location.href = nextUrl.href; }},
      localStorage: {getItem: () => null, setItem: noop},
    },
    document: {
      querySelector: find,
      querySelectorAll: selector => selector === ".part" ? catalog : targets,
      createElement: () => element(),
    },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: async (route, options) => {
      if (route === "/api/builds" && options?.method === "POST") {
        const build = {id: savedId, ...JSON.parse(options.body)};
        records.set(savedId, build);
        return {ok: true, json: async () => ({id: savedId, name: build.name})};
      }
      const build = records.get(route.split("/").at(-1));
      return {ok: Boolean(build), json: async () => build ?? {error: "Saved build not found."}};
    },
  });

  function flushTimers() {
    while (timers.size) {
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      fn();
    }
  }
  function place(id) {
    catalog[ids.indexOf(id)].click();
    targets[ids.indexOf(id)].click();
  }
  return {find, location, place, flushTimers, catalog, targets};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("demo saves to a link, reloads, then boots to BIOS and from the SSD", async () => {
  const records = new Map();
  const first = runApp(records);
  first.find("#demo-build").click();
  assert.equal(first.find("#compatibility-summary").textContent, "Valid build");
  first.find("#save-build").trigger("submit");
  await settle();
  assert.match(first.location.href, /\?build=/);
  const snapshot = records.get(savedId).configuration;
  assert.equal(snapshot.parts.length, ids.length);
  assert.equal(snapshot.parts.find(part => part.id === "psu").screws.length, 4);

  const reloaded = runApp(records, first.location.href);
  await settle();
  assert.match(reloaded.find("#saved-build-status").textContent, /Loaded Working demo build/);
  assert.equal(reloaded.find("#compatibility-summary").textContent, "Valid build");
  reloaded.find("#pc-power").click();
  reloaded.flushTimers();
  assert.equal(reloaded.find("#startup-display").dataset.state, "bios");
  reloaded.find("#boot-attempt").click();
  reloaded.flushTimers();
  assert.equal(reloaded.find("#startup-display").dataset.state, "booted");
});

test("reloading an incomplete snapshot retains the exact tightening progress", async () => {
  const records = new Map();
  const first = runApp(records);
  first.place("frontFan");
  first.find("#screw-groups").children[0].children[2].click();
  first.place("motherboard");
  first.find("#build-name").value = "In progress";
  first.find("#save-build").trigger("submit");
  await settle();
  assert.deepEqual(records.get(savedId).configuration.parts.map(part => part.id), ["motherboard", "frontFan"]);
  const reloaded = runApp(records, first.location.href);
  await settle();
  const screws = reloaded.find("#screw-groups").children[0].children.slice(1);
  assert.deepEqual(screws.map(screw => screw.disabled), [false, true, false, false]);
  assert.equal(reloaded.find("#compatibility-summary").textContent, "Build incomplete");
  reloaded.find("#pc-power").click();
  reloaded.flushTimers();
  assert.match(reloaded.find("#startup-detail").textContent, /PWR-MOUNT/);
});
