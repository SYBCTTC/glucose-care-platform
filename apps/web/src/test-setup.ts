/**
 * 前端单元测试在 node 环境下运行（本机守卫拦截了 jsdom 安装）。
 * 部分模块（如 store/theme.ts）在导入时访问浏览器 API，
 * 这里注入最小垫片，仅用于让模块能正常加载，不参与任何业务逻辑断言。
 */
const store = new Map<string, string>();

const localStorageStub: Storage = {
  get length(): number {
    return store.size;
  },
  clear: () => store.clear(),
  getItem: (key: string) => store.get(key) ?? null,
  key: () => null,
  removeItem: (key: string) => {
    store.delete(key);
  },
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageStub,
  configurable: true,
});

if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

(globalThis as unknown as { window: { matchMedia?: unknown } }).window.matchMedia = () => ({
  matches: false,
  media: '',
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
});
