import { vi } from 'vitest';

// The interface speaks the phone's language (@workoffdesk/i18n); a test hears English, whatever this machine
// speaks, unless it asks for another.
vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
