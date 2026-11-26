// Аккумулятор фиксированного шага: одинаковая физика при любом FPS.

export class FixedStepper {
  constructor(dt = 1 / 120, maxSteps = 8) {
    this.dt = dt;
    this.maxSteps = maxSteps;
    this.acc = 0;
    this.alpha = 0;
  }

  /** Прогоняет столько шагов stepFn(dt), сколько накопилось; возвращает их число. */
  advance(frameDt, stepFn) {
    if (!(frameDt > 0)) return 0;
    this.acc += frameDt;
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) {
      stepFn(this.dt);
      this.acc -= this.dt;
      n++;
    }
    if (n === this.maxSteps) this.acc = Math.min(this.acc, this.dt * 0.5);
    this.alpha = this.acc / this.dt;
    return n;
  }

  reset() {
    this.acc = 0;
    this.alpha = 0;
  }
}
