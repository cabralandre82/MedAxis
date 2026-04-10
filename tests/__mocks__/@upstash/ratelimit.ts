export class Ratelimit {
  constructor(_opts?: unknown) {}
  async limit(_identifier: string) {
    return { success: true, remaining: 59, reset: Date.now() + 60_000 }
  }
  static slidingWindow(max: number, _window: string) {
    return { type: 'slidingWindow', max }
  }
  static fixedWindow(max: number, _window: string) {
    return { type: 'fixedWindow', max }
  }
}
