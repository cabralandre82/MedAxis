export class Redis {
  static fromEnv() {
    return new Redis()
  }
  async get(_key: string) {
    return null
  }
  async set(_key: string, _value: unknown) {
    return 'OK'
  }
  async incr(_key: string) {
    return 1
  }
  async expire(_key: string, _ttl: number) {
    return 1
  }
}
