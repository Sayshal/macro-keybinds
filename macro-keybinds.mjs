import { MODULE } from './scripts/constants.mjs';
import { registerHooks } from './scripts/hooks.mjs';
import { registerStoredKeybindings } from './scripts/keybinds.mjs';
import { registerSettings } from './scripts/settings.mjs';

Hooks.once('init', () => {
  ATLAS.register(MODULE.ID, { title: MODULE.TITLE, github: 'Sayshal/macro-keybinds' });
  ATLAS.log(3, 'Initializing module');
  registerSettings();
  registerStoredKeybindings();
  registerHooks();
});
