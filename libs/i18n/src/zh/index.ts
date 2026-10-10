import type { Dict } from '../en';
import { common } from './common';
import { screen } from './screen';
import { chat } from './chat';
import { composer } from './composer';
import { sessions } from './sessions';
import { settings } from './settings';
import { setup } from './setup';

export const zh: Dict = { ...common, ...screen, ...chat, ...composer, ...sessions, ...settings, ...setup };
