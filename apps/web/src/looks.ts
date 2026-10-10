import { createLanguageChoice, createThemeChoice, type ThemeChoice } from '@workoffdesk/client/settings/choices';
import { storage } from './storage';

// The colours and the language chosen in Settings, as the phone has them (apps/mobile/src/theme.ts and
// language.ts). main.tsx imports this first: the language is handed to @workoffdesk/i18n before anything
// loads it, since its words are picked once, as it loads, so a new choice takes the page reloading.
export const themeChoice = createThemeChoice(storage);
export const languageChoice = createLanguageChoice(storage);

const language = languageChoice.get();
if (language !== 'system') (globalThis as { workoffdeskLanguage?: string }).workoffdeskLanguage = language;

// The stylesheet's colours follow <html data-theme>: dark, light or eye. index.html sets it before the first
// paint, the same way; from here on it follows the choice, and the device while that is 'system'.
const deviceDark = matchMedia('(prefers-color-scheme: dark)');
let chosen = themeChoice.get();

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = chosen === 'system' ? (deviceDark.matches ? 'dark' : 'light') : chosen;
  // iOS paints the strip below a short home-screen view in the theme colour, so it is the surface's.
  const surface = getComputedStyle(root).getPropertyValue('--surface').trim();
  if (surface) for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', surface);
}
applyTheme();
deviceDark.addEventListener('change', applyTheme);

export function setTheme(choice: ThemeChoice) {
  chosen = choice;
  themeChoice.keep(choice);
  applyTheme();
}
