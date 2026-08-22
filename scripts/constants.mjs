/** @type {object} Module-wide identifiers, setting keys and keybind parsing values. */
export const MODULE = {
  ID: 'macro-keybinds',
  TITLE: 'Macro Keybinds',

  SETTINGS: {
    DISABLE_DEFAULT_HOTBAR: 'disableDefaultHotbar',
    USER_KEYBINDS: 'userKeybinds'
  },

  /** How long a keybind pressed on an unsaved macro waits for that macro to be created. */
  PENDING_TTL_MS: 30_000
};
