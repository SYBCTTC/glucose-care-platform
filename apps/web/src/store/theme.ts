import { create } from 'zustand';
import type { FontScale, ThemeMode } from '@/styles/tokens';

/**
 * 主题状态：明/暗 + 字号档（适老）。
 * 同时把结果写到 <html data-theme / data-font>，驱动 global.css 的 CSS 变量。
 */

const MODE_KEY = 'gc_theme_mode';
const FONT_KEY = 'gc_font_scale';

function readMode(): ThemeMode {
  const saved = localStorage.getItem(MODE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  // 未选择过则跟随系统
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readFontScale(): FontScale {
  return localStorage.getItem(FONT_KEY) === 'large' ? 'large' : 'standard';
}

/** 同步到文档根节点，必须在首帧渲染前调用一次，避免闪白 */
export function applyDocumentTheme(mode: ThemeMode, fontScale: FontScale): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.font = fontScale;
}

interface ThemeState {
  mode: ThemeMode;
  fontScale: FontScale;
  toggleMode: () => void;
  toggleFontScale: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readMode(),
  fontScale: readFontScale(),

  toggleMode: () => {
    const mode: ThemeMode = get().mode === 'dark' ? 'light' : 'dark';
    localStorage.setItem(MODE_KEY, mode);
    applyDocumentTheme(mode, get().fontScale);
    set({ mode });
  },

  toggleFontScale: () => {
    const fontScale: FontScale = get().fontScale === 'large' ? 'standard' : 'large';
    localStorage.setItem(FONT_KEY, fontScale);
    applyDocumentTheme(get().mode, fontScale);
    set({ fontScale });
  },
}));
