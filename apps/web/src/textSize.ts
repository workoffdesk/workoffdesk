import { textSize } from './platform';

export { TEXT_MAX, TEXT_MIN, TEXT_STEP } from '@workoffdesk/client/settings/textSize';

export const getTextSize = textSize.get;

// Every font size in the stylesheet is its designed size times --text-scale.
export function applyTextSize(n = getTextSize()) {
  document.documentElement.style.setProperty('--text-scale', String(n / 100));
}

export function setTextSize(n: number) {
  applyTextSize(n);
  textSize.keep(n);
}
