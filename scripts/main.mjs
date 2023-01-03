import { TowerDefense } from './td.mjs';

let td = new TowerDefense();

Hooks.once('init', function () {
  td.init();
});

Hooks.once('ready', function () {
  window.magtd = {
    tick : async function() { await td.tick() },
    toggleWave : async function() { await td.toggleWave() }
  }
});