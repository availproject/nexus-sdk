export type TuiTheme = {
  name: string;
  title: string;
  accent: string;
  border: string;
  borderFocus: string;
  muted: string;
  text: string;
  success: string;
  warn: string;
  error: string;
  info: string;
  chartPalette: readonly string[];
};

// Default theme — Lipgloss/Charm hex palette: vivid pink titles, purple accents,
// neon green/red/cyan status colors, dark-gray structural borders.
export const lipglossCharmTheme: TuiTheme = {
  name: 'lipgloss-charm',
  title: '#FF79C6', // charm pink    — titles, primary highlight
  accent: '#BD93F9', // charm purple  — interactive, focus, running
  border: '#44475A', // charm surface — structural borders
  borderFocus: '#FF79C6',
  muted: '#6272A4', // charm comment — secondary/dim text
  text: '#F8F8F2', // charm foreground — primary text
  success: '#50FA7B', // charm green
  warn: '#FFB86C', // charm orange
  error: '#FF5555', // charm red
  info: '#8BE9FD', // charm cyan
  chartPalette: ['#8BE9FD', '#BD93F9', '#FF79C6', '#50FA7B', '#FFB86C', '#F1FA8C'],
};

// Dracula palette, cyan/pink roles swapped vs lipgloss-charm for a distinct hacker look.
export const draculaVividTheme: TuiTheme = {
  name: 'dracula-vivid',
  title: '#8BE9FD', // dracula cyan    — titles
  accent: '#FF79C6', // dracula pink    — interactive, focus
  border: '#44475A', // dracula surface — structural borders
  borderFocus: '#8BE9FD',
  muted: '#6272A4', // dracula comment
  text: '#F8F8F2', // dracula foreground
  success: '#50FA7B', // dracula green
  warn: '#FFB86C', // dracula orange
  error: '#FF5555', // dracula red
  info: '#BD93F9', // dracula purple  — info (swapped with accent)
  chartPalette: ['#FF79C6', '#BD93F9', '#8BE9FD', '#50FA7B', '#FFB86C', '#F1FA8C'],
};

// Catppuccin Mocha palette: soft mauve titles, sapphire blue accents, pastel status colors.
export const catppuccinMochaPopTheme: TuiTheme = {
  name: 'catppuccin-mocha-pop',
  title: '#CBA6F7', // catppuccin mauve    — titles
  accent: '#89B4FA', // catppuccin blue     — interactive, focus
  border: '#45475A', // catppuccin surface1 — structural borders
  borderFocus: '#CBA6F7',
  muted: '#6C7086', // catppuccin overlay0
  text: '#CDD6F4', // catppuccin text     — slightly blue-tinted white
  success: '#A6E3A1', // catppuccin green    — soft, not neon
  warn: '#FAB387', // catppuccin peach    — distinctive orange-pink
  error: '#F38BA8', // catppuccin red
  info: '#89DCEB', // catppuccin sky
  chartPalette: ['#89B4FA', '#CBA6F7', '#89DCEB', '#A6E3A1', '#FAB387', '#F9E2AF'],
};

// Tokyo Night palette: deep violet titles, electric cyan accents, muted blue-gray structure.
export const neonTokyoTheme: TuiTheme = {
  name: 'neon-tokyo',
  title: '#BB9AF7', // tokyo night purple — titles
  accent: '#7DCFFF', // tokyo night cyan   — interactive, focus
  border: '#3B4261', // tokyo night border — structural
  borderFocus: '#BB9AF7',
  muted: '#565F89', // tokyo night comment
  text: '#C0CAF5', // tokyo night foreground
  success: '#9ECE6A', // tokyo night green
  warn: '#E0AF68', // tokyo night yellow
  error: '#F7768E', // tokyo night red
  info: '#2AC3DE', // tokyo night teal
  chartPalette: ['#7DCFFF', '#BB9AF7', '#2AC3DE', '#9ECE6A', '#E0AF68', '#FF007C'],
};

export const TUI_THEMES = {
  'lipgloss-charm': lipglossCharmTheme,
  'dracula-vivid': draculaVividTheme,
  'catppuccin-mocha-pop': catppuccinMochaPopTheme,
  'neon-tokyo': neonTokyoTheme,
} as const;

export type TuiThemeName = keyof typeof TUI_THEMES;

export const TUI_THEME_NAMES = Object.keys(TUI_THEMES) as TuiThemeName[];

export const DEFAULT_TUI_THEME = lipglossCharmTheme;

export let activeTuiTheme: TuiTheme = DEFAULT_TUI_THEME;

export const resolveTuiTheme = (name?: string): TuiTheme => {
  if (!name) return DEFAULT_TUI_THEME;
  return TUI_THEMES[name as TuiThemeName] ?? DEFAULT_TUI_THEME;
};

export const setActiveTuiThemeByName = (name?: string) => {
  activeTuiTheme = resolveTuiTheme(name);
  return activeTuiTheme;
};
