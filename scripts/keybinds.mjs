import { MODULE } from './constants.mjs';

/**
 * Read the stored keybinds, treating anything but a plain object as empty.
 * @returns {object} Map of macro id to stored keybind entry.
 */
export function getUserKeybinds() {
  const keybinds = game.settings.get(MODULE.ID, MODULE.SETTINGS.USER_KEYBINDS);
  return foundry.utils.getType(keybinds) === 'Object' ? keybinds : {};
}

/**
 * Persist the stored keybinds, coercing invalid input to an empty object.
 * @param {object} keybinds Map of macro id to stored keybind entry.
 * @returns {Promise<void>}
 */
export async function setUserKeybinds(keybinds) {
  await game.settings.set(MODULE.ID, MODULE.SETTINGS.USER_KEYBINDS, foundry.utils.getType(keybinds) === 'Object' ? keybinds : {});
}

/**
 * Write (or delete) the stored keybind for a macro and sync the active binding.
 * @param {string} macroId The macro document id to bind against.
 * @param {object|null} [keybindData] Pass null/undefined to remove the binding.
 * @returns {Promise<void>}
 */
export async function updateStoredKeybinds(macroId, keybindData = null) {
  if (!macroId) {
    ATLAS.log(2, 'Cannot store a keybind for a macro with no ID');
    return;
  }
  const keybinds = getUserKeybinds();
  if (keybindData) {
    const modifiers = standardizeModifiers(keybindData.modifiers || []);
    keybinds[macroId] = { key: keybindData.key, name: keybindData.name, modifiers, keybind: formatKeybind({ ...keybindData, modifiers }) };
    if (game.keybindings.bindings.has(`${MODULE.ID}.execute.${macroId}`)) await game.keybindings.set(MODULE.ID, `execute.${macroId}`, [{ key: keybindData.key, modifiers }]);
  } else delete keybinds[macroId];
  await setUserKeybinds(keybinds);
}

/** Register a Foundry keybinding action for every macro with a stored keybind. */
export function registerStoredKeybindings() {
  const keybinds = getUserKeybinds();
  ATLAS.log(3, 'Registering stored keybindings');
  for (const [macroId, data] of Object.entries(keybinds)) {
    if (!data?.key) continue;
    const modifiers = standardizeModifiers(data.modifiers || []);
    try {
      game.keybindings.register(MODULE.ID, `execute.${macroId}`, {
        name: data.name,
        editable: [{ key: data.key, modifiers }],
        onDown: () => {
          game.macros.get(macroId)?.execute();
          return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
      });
    } catch (error) {
      ATLAS.log(1, 'Error registering keybinding:', error);
    }
  }
}

/**
 * Render a keybind as a human-readable string like `Control+Shift+G`.
 * @param {object} keybind Keybind shape with `key`, optional `simKey`, optional `modifiers`.
 * @returns {string} The formatted modifier+key string, or `''` when no key is set.
 */
export function formatKeybind(keybind) {
  if (!keybind?.key) return '';
  const displayKey = keybind.simKey || getDisplayKey(keybind.key);
  const uniqueModifiers = [...new Set(keybind.modifiers || [])];
  return [...uniqueModifiers, displayKey].join('+');
}

/**
 * Strip the `Key`/`Digit` prefix from a KeyboardEvent.code for display.
 * @param {string} keyCode Raw KeyboardEvent.code value.
 * @returns {string} Display-friendly key name.
 */
function getDisplayKey(keyCode) {
  if (keyCode.startsWith('Key')) return keyCode.substring(3);
  if (keyCode.startsWith('Digit')) return keyCode.substring(5);
  return keyCode;
}

/**
 * Whether a KeyboardEvent.code only qualifies another key.
 * @param {string} code Raw KeyboardEvent.code value.
 * @returns {boolean} True when the code is a modifier Foundry recognizes.
 */
export function isModifierCode(code) {
  return Object.values(foundry.helpers.interaction.KeyboardManager.MODIFIER_CODES).some((codes) => codes.includes(code));
}

/**
 * Resolve held KeyboardEvent.code values to the modifier names Foundry accepts.
 * @param {Set<string>} modifierSet Active modifier KeyboardEvent.code values.
 * @returns {string[]} Foundry modifier names.
 */
export function getStandardizedModifiers(modifierSet) {
  const { MODIFIER_CODES } = foundry.helpers.interaction.KeyboardManager;
  return Object.keys(MODIFIER_CODES).filter((name) => MODIFIER_CODES[name].some((code) => modifierSet.has(code)));
}

/**
 * Normalize stored modifier names, which earlier versions wrote uppercased and under a META of their own.
 * @param {string[]} modifiers Modifier names as read back from the setting.
 * @returns {string[]} Foundry modifier names, deduplicated because META folds onto an already-possible Control.
 */
export function standardizeModifiers(modifiers) {
  const { MODIFIER_KEYS } = foundry.helpers.interaction.KeyboardManager;
  const names = modifiers.map((mod) => {
    const upperMod = mod.toUpperCase();
    return MODIFIER_KEYS[upperMod === 'META' ? 'CONTROL' : upperMod] ?? mod;
  });
  return [...new Set(names)];
}
