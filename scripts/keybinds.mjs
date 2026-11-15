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
  if (!keybindData && !(macroId in keybinds)) return;
  const modifiers = standardizeModifiers(keybindData?.modifiers || []);
  if (keybindData) keybinds[macroId] = { key: keybindData.key, name: keybindData.name, modifiers, keybind: formatKeybind(keybindData) };
  else delete keybinds[macroId];
  await setUserKeybinds(keybinds);
  const actionName = `execute.${macroId}`;
  const action = `${MODULE.ID}.${actionName}`;
  if (game.keybindings.actions.has(action)) {
    await game.keybindings.set(MODULE.ID, actionName, keybindData ? [{ key: keybindData.key, modifiers }] : []);
    return;
  }
  const coreBindings = game.settings.get('core', 'keybindings');
  if (!(action in coreBindings)) return;
  delete coreBindings[action];
  await game.settings.set('core', 'keybindings', coreBindings);
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
 * Render a keybind as a human-readable string like `Control+Shift+G`, with modifiers in a fixed order.
 * @param {object} keybind Keybind shape with `key` and optional `modifiers`.
 * @returns {string} The formatted modifier+key string, or `''` when no key is set.
 */
export function formatKeybind(keybind) {
  if (!keybind?.key) return '';
  const modifiers = standardizeModifiers(keybind.modifiers || []);
  const { KeyboardManager } = foundry.helpers.interaction;
  const orderedModifiers = Object.values(KeyboardManager.MODIFIER_KEYS).filter((name) => modifiers.includes(name));
  return [...orderedModifiers, KeyboardManager.getKeycodeDisplayString(keybind.key)].join('+');
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
