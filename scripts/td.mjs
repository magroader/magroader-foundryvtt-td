import { WaveTick } from './wavetick.mjs';

export class TowerDefense {

  constructor() {
    this._tick = null;
    this._runningWave = false;
  }

  init() {
  }

  async tick() {
    if (this._tick)
      return;

    let result = false;
    this._tick = new WaveTick();    
    try {
      result = await this._tick.performTick();
    } catch (error) {
      console.error(error);
      result = false;
    } finally {
      this._tick = null;
    }
    return result;
  }

  async toggleWave() {
    if (this._runningWave) {
      this._runningWave = false;
    } else {
      this._runningWave = true;
      while (this._runningWave) {
        let keepGoing = await this.tick();
        if (this._runningWave && keepGoing) {
          await this.sleep(250);
        }
        if (!keepGoing) {
          this._runningWave = false;
        }
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}