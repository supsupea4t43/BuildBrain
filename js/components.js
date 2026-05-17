// js/components.js

async function loadComponents() {
  const [cpus, gpus, motherboards, rams, psus, cases, storage] = await Promise.all([
    fetch('./data/cpus.json').then(r => r.json()),
    fetch('./data/gpus.json').then(r => r.json()),
    fetch('./data/motherboards.json').then(r => r.json()),
    fetch('./data/rams.json').then(r => r.json()),
    fetch('./data/psus.json').then(r => r.json()),
    fetch('./data/cases.json').then(r => r.json()),
    fetch('./data/storage.json').then(r => r.json()),
  ]);
  return { cpus, gpus, motherboards, rams, psus, cases, storage };
}