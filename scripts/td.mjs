import { WaveTick } from './wavetick.mjs';

export class TowerDefense {

  constructor() {
    this._tick = null;
  }

  init() {
  }

  async tick() {
    if (this._tick)
      return;

    this._tick = new WaveTick();    
    try {
      await this._tick.performTick();
    } catch (error) {
      console.error(error);
    } finally {
      this._tick = null;
    }
  }
}