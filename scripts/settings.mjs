import { MODULE } from './constants.mjs';

/** Clear all core executeMacro<N> bindings so number keys no longer fire the hotbar. */
async function deleteMacroKeybindings() {
  for (const [actionId] of game.keybindings.bindings) {
    if (!/^core\.executeMacro\d$/.test(actionId)) continue;
    await game.keybindings.set('core', actionId.split('.')[1], []);
  }
}

/** Restore the default Digit0-Digit9 bindings for core executeMacro<N>. */
async function resetMacroKeybindings() {
  for (let i = 0; i < 10; i++) await game.keybindings.set('core', `executeMacro${i}`, [{ key: `Digit${i}`, modifiers: [] }]);
}

/**
 * Register the module's settings.
 * @returns {void}
 */
export function registerSettings() {
  game.settings.register(MODULE.ID, MODULE.SETTINGS.DISABLE_DEFAULT_HOTBAR, {
    name: 'MACROKEYBINDS.Settings.DisableDefaultHotbar.Name',
    hint: 'MACROKEYBINDS.Settings.DisableDefaultHotbar.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
    onChange: (value) => (value ? deleteMacroKeybindings() : resetMacroKeybindings())
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.USER_KEYBINDS, { scope: 'user', config: false, type: Object, default: {} });
}
