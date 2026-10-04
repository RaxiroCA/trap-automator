/*
 * Trap Manager
 *
 * A settings-menu application (Configure Settings → The Horse's Trap
 * Automator → Open Trap Manager) for customising the trap and cache types the
 * module offers. The GM can add new types, edit built-in ones (stored as
 * overrides), hide built-ins they don't want, delete their own types, and
 * manage each type's hint sets (one hint per tier: +2, +4, +6, +10).
 *
 * Everything is stored in the world setting "customDefs", the same object the
 * Add/Edit Definition dialogs use. Built-in types are never modified in place:
 *   customDefs.trap[key] / customDefs.cache[key]  new types and overrides
 *   customDefs.hidden.trap / customDefs.hidden.cache  keys removed from menus
 * TrapAutomator#rebuildDefinitions() layers these over the built-in JSON.
 */

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const MODULE_ID = 'trap-automator';
const TIERS = ['+2', '+4', '+6', '+10'];
const LOCATIONS = ['floor', 'wall', 'ceiling', 'other'];
const SAVES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const PRIMARY_CATEGORIES = ['generic', 'sci-fi', 'magical', 'natural', 'grimdark'];
const STATUS_LABELS = { builtin: 'Built-in', modified: 'Modified', custom: 'Custom' };

export class TrapManager extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    // Which definitions are listed: 'trap' or 'cache'.
    this.type = 'trap';
    // Key of the entry being edited (null for a new, unsaved entry).
    this.selectedKey = null;
    // Working copy of the entry being edited; see _draftFromDef().
    this.draft = null;
    // True when the draft has unsaved changes.
    this.dirty = false;
    // Text in the search box, kept across re-renders.
    this.filter = '';
  }

  static DEFAULT_OPTIONS = {
    id: 'trap-automator-manager',
    classes: ['trap-automator', 'ta-manager'],
    tag: 'div',
    window: {
      title: 'Trap Manager',
      icon: 'fas fa-dungeon',
      resizable: true
    },
    position: { width: 980, height: 740 },
    actions: {
      switchType: TrapManager.#onSwitchType,
      selectEntry: TrapManager.#onSelectEntry,
      newEntry: TrapManager.#onNewEntry,
      addSet: TrapManager.#onAddSet,
      removeSet: TrapManager.#onRemoveSet,
      saveEntry: TrapManager.#onSaveEntry,
      deleteEntry: TrapManager.#onDeleteEntry,
      revertEntry: TrapManager.#onRevertEntry,
      toggleHidden: TrapManager.#onToggleHidden,
      exportDefs: TrapManager.#onExport,
      importDefs: TrapManager.#onImport
    }
  };

  static PARTS = {
    main: {
      template: 'modules/trap-automator/templates/trap-manager.hbs',
      scrollable: ['.ta-manager-list', '.ta-manager-editor']
    }
  };

  /** The live TrapAutomator instance. */
  get automator() {
    return game.trapAutomator;
  }

  /* -------------------------------------------- */
  /*  Data                                        */
  /* -------------------------------------------- */

  /**
   * Read a mutable copy of the stored custom definitions.
   * @returns {Object}
   */
  _readCustom() {
    return foundry.utils.duplicate(game.settings.get(MODULE_ID, 'customDefs') || {});
  }

  /**
   * List every definition of the current type, built-in and custom, with its
   * status. Hidden entries are included (they can be unhidden).
   * @returns {Array<{key, name, category, status, hidden, def}>}
   */
  _entries() {
    const builtin = this.automator.builtinDefs?.[this.type] ?? {};
    const custom = this._readCustom();
    const customDefs = custom[this.type] ?? {};
    const hidden = new Set(custom.hidden?.[this.type] ?? []);
    const keys = new Set([...Object.keys(builtin), ...Object.keys(customDefs)]);
    return [...keys].map(key => {
      const isBuiltin = key in builtin;
      const isCustom = key in customDefs;
      const def = this._effectiveDef(builtin[key], customDefs[key]);
      return {
        key,
        name: def.name || key,
        category: def.category || 'misc',
        status: isBuiltin ? (isCustom ? 'modified' : 'builtin') : 'custom',
        hidden: hidden.has(key),
        def
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Combine a built-in definition with its stored override the same way
   * rebuildDefinitions() does: objects merge, arrays (hint sets) replace.
   * @param {Object} [builtinDef]
   * @param {Object} [customDef]
   * @returns {Object}
   */
  _effectiveDef(builtinDef, customDef) {
    return foundry.utils.mergeObject(
      foundry.utils.duplicate(builtinDef ?? {}),
      foundry.utils.duplicate(customDef ?? {}),
      { inplace: false }
    );
  }

  /**
   * Extract the hint sets from a definition. Built-in hints are identical for
   * every location, so the floor list (or the first location present) is
   * used. The legacy shape { '+2': [...], ... } is converted to sets.
   * @param {Object} def
   * @returns {Array<Object<string, string>>}
   */
  static hintSetsFromDef(def) {
    const hints = def?.hints ?? {};
    const loc = LOCATIONS.find(l => hints[l]) ?? null;
    const raw = loc ? hints[loc] : null;
    const sets = [];
    if (Array.isArray(raw)) {
      for (const set of raw) sets.push(Object.fromEntries(TIERS.map(t => [t, String(set?.[t] ?? '')])));
    } else if (raw && typeof raw === 'object') {
      const count = Math.max(0, ...TIERS.map(t => (Array.isArray(raw[t]) ? raw[t].length : 0)));
      for (let i = 0; i < count; i++) sets.push(Object.fromEntries(TIERS.map(t => [t, String(raw[t]?.[i] ?? '')])));
    }
    return sets;
  }

  /**
   * Build an editable draft from a definition.
   * @param {string|null} key Definition key (null for a new entry)
   * @param {Object} def Effective definition
   * @returns {Object} Draft
   */
  _draftFromDef(key, def = {}) {
    const TA = this.automator.constructor;
    const sets = TrapManager.hintSetsFromDef(def);
    return {
      key,
      name: def.name ?? '',
      category: def.category ?? (this.type === 'trap' ? 'generic' : ''),
      attackType: def.attackType === 'attack' ? 'attack' : 'save',
      defaultSave: SAVES.includes(String(def.defaultSave).toLowerCase()) ? String(def.defaultSave).toLowerCase() : 'dex',
      defaultDC: Number(def.defaultDC) || 10,
      defaultAttackBonus: Number(def.defaultAttackBonus ?? TA.DEFAULT_ATTACK_BONUS),
      defaultDetectionDC: Number(def.defaultDetectionDC) || TA.DEFAULT_DETECTION_DC,
      description: {
        flavor: def.description?.flavor ?? '',
        fail: def.description?.fail ?? '',
        success: def.description?.success ?? '',
        found: def.description?.found ?? ''
      },
      sets: sets.length ? sets : [Object.fromEntries(TIERS.map(t => [t, '']))]
    };
  }

  /**
   * Validate a draft and turn it into a definition for customDefs.
   * @param {Object} draft
   * @returns {{def?: Object, errors: string[]}}
   */
  _buildDefinition(draft) {
    const errors = [];
    const name = String(draft.name ?? '').trim();
    if (!name) errors.push('Give it a name.');
    const category = String(draft.category ?? '').trim().toLowerCase();
    if (this.type === 'trap' && !category) errors.push('Choose or type a category.');
    if (this.type === 'trap' && !String(draft.description?.flavor ?? '').trim()) {
      errors.push('Write a description of what happens when the trap springs.');
    }
    // Drop sets that are completely empty; every other set needs all four tiers.
    const sets = [];
    (draft.sets ?? []).forEach((set, i) => {
      const clean = Object.fromEntries(TIERS.map(t => [t, String(set?.[t] ?? '').trim()]));
      const filled = TIERS.filter(t => clean[t]);
      if (!filled.length) return;
      const missing = TIERS.filter(t => !clean[t]);
      if (missing.length) errors.push(`Hint set ${i + 1} is missing the ${missing.join(', ')} hint${missing.length > 1 ? 's' : ''}.`);
      sets.push(clean);
    });
    if (!sets.length) errors.push('Add at least one hint set with all four hints.');
    if (errors.length) return { errors };

    const hints = Object.fromEntries(LOCATIONS.map(l => [l, foundry.utils.duplicate(sets)]));
    const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);
    const TA = this.automator.constructor;
    let def;
    if (this.type === 'trap') {
      def = {
        name,
        category,
        attackType: draft.attackType === 'attack' ? 'attack' : 'save',
        defaultSave: SAVES.includes(draft.defaultSave) ? draft.defaultSave : 'dex',
        defaultDC: num(draft.defaultDC, 10),
        defaultAttackBonus: num(draft.defaultAttackBonus, TA.DEFAULT_ATTACK_BONUS),
        defaultDetectionDC: num(draft.defaultDetectionDC, TA.DEFAULT_DETECTION_DC),
        description: {
          flavor: String(draft.description?.flavor ?? '').trim(),
          fail: String(draft.description?.fail ?? '').trim(),
          success: String(draft.description?.success ?? '').trim()
        },
        hints
      };
    } else {
      def = {
        name,
        defaultDetectionDC: num(draft.defaultDetectionDC, TA.DEFAULT_DETECTION_DC),
        description: { found: String(draft.description?.found ?? '').trim() },
        hints
      };
      if (category) def.category = category;
    }
    return { def, errors };
  }

  /**
   * Every category the placement menus know about: the five primary
   * categories plus any used by a definition or added as a custom category.
   * @returns {string[]}
   */
  _knownCategories() {
    return [...new Set([...PRIMARY_CATEGORIES, ...this.automator.getAllCategories()])].sort();
  }

  /**
   * Choose a key for a new entry that doesn't collide with an existing one.
   * @param {string} name
   * @returns {string}
   */
  _uniqueKey(name) {
    const taken = new Set(this._entries().map(e => e.key));
    const base = this.automator.slugify(name);
    let key = base;
    for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
    return key;
  }

  /**
   * Save the current draft into customDefs and reload it from the result.
   * @returns {Promise<boolean>} Whether it was saved
   */
  async saveDraft() {
    const { def, errors } = this._buildDefinition(this.draft);
    if (errors.length) {
      ui.notifications.warn(`Trap Manager: ${errors.join(' ')}`);
      return false;
    }
    const custom = this._readCustom();
    const key = this.draft.key ?? this._uniqueKey(def.name);
    custom[this.type] ??= {};
    custom[this.type][key] = def;
    // A category typed by hand becomes a custom primary category so it shows
    // up in the placement menus.
    if (def.category && !this._knownCategories().includes(def.category)) {
      custom.categories ??= {};
      custom.categories[def.category] ??= { name: def.category };
    }
    await this.automator.saveCustomDefinitions(custom);
    this.selectedKey = key;
    this.draft = this._draftFromDef(key, this._entries().find(e => e.key === key)?.def);
    this.dirty = false;
    ui.notifications.info(`Trap Manager: saved "${def.name}".`);
    return true;
  }

  /**
   * Hide or unhide an entry. Hidden entries stay in the Trap Manager but no
   * longer appear when placing traps or caches.
   * @param {string} key
   * @param {boolean} hide
   */
  async setHidden(key, hide) {
    const custom = this._readCustom();
    custom.hidden ??= {};
    const list = new Set(custom.hidden[this.type] ?? []);
    if (hide) list.add(key);
    else list.delete(key);
    custom.hidden[this.type] = [...list];
    await this.automator.saveCustomDefinitions(custom);
  }

  /**
   * Remove an entry's stored definition: deletes a custom entry, or reverts
   * a modified built-in to the shipped version.
   * @param {string} key
   */
  async removeCustom(key) {
    const custom = this._readCustom();
    if (custom[this.type]) delete custom[this.type][key];
    const builtin = this.automator.builtinDefs?.[this.type] ?? {};
    // A deleted custom entry shouldn't linger in the hidden list.
    if (!(key in builtin) && custom.hidden?.[this.type]) {
      custom.hidden[this.type] = custom.hidden[this.type].filter(k => k !== key);
    }
    await this.automator.saveCustomDefinitions(custom);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const TA = this.automator.constructor;
    const entries = this._entries();
    const fmt = TA.formatLabel;

    // Group the list by category.
    const groups = new Map();
    for (const entry of entries) {
      const label = fmt(entry.category);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({
        key: entry.key,
        name: entry.name,
        status: entry.status,
        statusLabel: STATUS_LABELS[entry.status],
        hidden: entry.hidden,
        selected: entry.key === this.selectedKey,
        search: `${entry.name} ${entry.category} ${entry.key}`.toLowerCase()
      });
    }
    const sortedGroups = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, items]) => ({ label, items }));

    let editor = null;
    if (this.draft) {
      const entry = entries.find(e => e.key === this.draft.key);
      const hintDCs = TA.hintDCsFor(this.draft.defaultDetectionDC);
      editor = {
        ...this.draft,
        isNew: !this.draft.key,
        status: entry?.status ?? 'custom',
        statusLabel: entry ? STATUS_LABELS[entry.status] : 'New',
        hidden: !!entry?.hidden,
        canDelete: entry?.status === 'custom',
        canRevert: entry?.status === 'modified',
        canHide: !!entry,
        isAttack: this.draft.attackType === 'attack',
        saveOptions: SAVES.map(s => ({ value: s, label: s.toUpperCase(), selected: s === this.draft.defaultSave })),
        sets: this.draft.sets.map((set, index) => ({
          index,
          number: index + 1,
          canRemove: this.draft.sets.length > 1,
          tiers: TIERS.map(tier => ({ tier, value: set[tier] ?? '', dc: hintDCs[tier], field: `sets.${index}.${tier}` }))
        }))
      };
    }

    return Object.assign(context, {
      isTrap: this.type === 'trap',
      typeLabel: this.type === 'trap' ? 'Trap' : 'Cache',
      filter: this.filter,
      groups: sortedGroups,
      count: entries.length,
      hiddenCount: entries.filter(e => e.hidden).length,
      categories: this._knownCategories().map(c => ({ value: c, label: fmt(c) })),
      editor,
      dirty: this.dirty
    });
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;

    // Search box filters the list in place so typing never loses focus.
    const search = root.querySelector('.ta-manager-search');
    const applyFilter = () => {
      const q = this.filter.trim().toLowerCase();
      for (const li of root.querySelectorAll('.ta-manager-entry')) {
        li.hidden = !!q && !li.dataset.search.includes(q);
      }
      for (const group of root.querySelectorAll('.ta-manager-group')) {
        group.hidden = !group.querySelector('.ta-manager-entry:not([hidden])');
      }
    };
    search?.addEventListener('input', ev => {
      this.filter = ev.target.value;
      applyFilter();
    });
    applyFilter();

    // Copy every edit into the draft so re-renders (add set, switch attack
    // type) keep what was typed.
    for (const input of root.querySelectorAll('[data-field]')) {
      const update = ev => {
        const el = ev.target;
        const value = el.dataset.dtype === 'Number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
        foundry.utils.setProperty(this.draft, el.dataset.field, value);
        this.dirty = true;
      };
      input.addEventListener('input', update);
      input.addEventListener('change', ev => {
        update(ev);
        // These change what the editor shows, so redraw it.
        if (['attackType', 'defaultDetectionDC'].includes(ev.target.dataset.field)) this.render();
      });
    }
  }

  /**
   * Ask before throwing away unsaved edits.
   * @returns {Promise<boolean>} Whether it's OK to continue
   */
  async _confirmDiscard() {
    if (!this.dirty) return true;
    return DialogV2.confirm({
      window: { title: 'Discard changes?' },
      content: '<p>You have unsaved changes to this entry. Discard them?</p>'
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onSwitchType(event, target) {
    const type = target.dataset.type === 'cache' ? 'cache' : 'trap';
    if (type === this.type || !(await this._confirmDiscard())) return;
    this.type = type;
    this.selectedKey = null;
    this.draft = null;
    this.dirty = false;
    this.render();
  }

  static async #onSelectEntry(event, target) {
    const key = target.closest('[data-key]')?.dataset.key;
    if (!key || key === this.selectedKey || !(await this._confirmDiscard())) return;
    const entry = this._entries().find(e => e.key === key);
    this.selectedKey = key;
    this.draft = this._draftFromDef(key, entry?.def);
    this.dirty = false;
    this.render();
  }

  static async #onNewEntry() {
    if (!(await this._confirmDiscard())) return;
    this.selectedKey = null;
    this.draft = this._draftFromDef(null, {});
    this.dirty = true;
    this.render();
  }

  static #onAddSet() {
    if (!this.draft) return;
    this.draft.sets.push(Object.fromEntries(TIERS.map(t => [t, ''])));
    this.dirty = true;
    this.render();
  }

  static #onRemoveSet(event, target) {
    const index = Number(target.closest('[data-set]')?.dataset.set);
    if (!this.draft || this.draft.sets.length <= 1 || !Number.isInteger(index)) return;
    this.draft.sets.splice(index, 1);
    this.dirty = true;
    this.render();
  }

  static async #onSaveEntry() {
    if (!this.draft) return;
    if (await this.saveDraft()) this.render();
  }

  static async #onDeleteEntry() {
    const key = this.draft?.key;
    if (!key) return;
    const ok = await DialogV2.confirm({
      window: { title: `Delete ${this.draft.name}?` },
      content: `<p>Permanently delete <strong>${foundry.utils.escapeHTML(this.draft.name)}</strong>? Traps and caches already placed on scenes are not affected.</p>`
    });
    if (!ok) return;
    await this.removeCustom(key);
    this.selectedKey = null;
    this.draft = null;
    this.dirty = false;
    this.render();
  }

  static async #onRevertEntry() {
    const key = this.draft?.key;
    if (!key) return;
    const ok = await DialogV2.confirm({
      window: { title: 'Revert to built-in?' },
      content: `<p>Discard your changes to <strong>${foundry.utils.escapeHTML(this.draft.name)}</strong> and restore the version that ships with the module?</p>`
    });
    if (!ok) return;
    await this.removeCustom(key);
    this.draft = this._draftFromDef(key, this._entries().find(e => e.key === key)?.def);
    this.dirty = false;
    this.render();
  }

  static async #onToggleHidden(event, target) {
    const key = target.closest('[data-key]')?.dataset.key ?? this.draft?.key;
    if (!key) return;
    const entry = this._entries().find(e => e.key === key);
    if (!entry) return;
    await this.setHidden(key, !entry.hidden);
    this.render();
  }

  static #onExport() {
    const custom = this._readCustom();
    foundry.utils.saveDataToFile(JSON.stringify(custom, null, 2), 'text/json', 'trap-automator-definitions.json');
  }

  static async #onImport() {
    const choice = await DialogV2.wait({
      window: { title: 'Import Trap Definitions' },
      content: `<p>Choose a file exported from the Trap Manager.</p>
        <div class="form-group"><input type="file" name="file" accept=".json,application/json" /></div>
        <p class="hint"><strong>Merge</strong> adds and updates entries from the file and keeps the rest. <strong>Replace</strong> discards all your current customisations first.</p>`,
      buttons: [
        { action: 'merge', label: 'Merge', default: true, callback: (event, button) => ({ mode: 'merge', file: button.form.elements.file.files[0] }) },
        { action: 'replace', label: 'Replace', callback: (event, button) => ({ mode: 'replace', file: button.form.elements.file.files[0] }) },
        { action: 'cancel', label: 'Cancel' }
      ],
      rejectClose: false
    });
    if (!choice?.file) return;
    let data;
    try {
      data = JSON.parse(await foundry.utils.readTextFromFile(choice.file));
    } catch (err) {
      ui.notifications.error('Trap Manager: that file is not valid JSON.');
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      ui.notifications.error('Trap Manager: that file does not contain trap definitions.');
      return;
    }
    await this.importDefinitions(data, choice.mode);
    this.selectedKey = null;
    this.draft = null;
    this.dirty = false;
    this.render();
  }

  /**
   * Apply imported definitions to customDefs.
   * @param {Object} data Parsed export file
   * @param {'merge'|'replace'} mode
   */
  async importDefinitions(data, mode) {
    const custom = mode === 'replace' ? {} : this._readCustom();
    for (const section of ['trap', 'cache', 'triggers', 'categories']) {
      if (data[section] && typeof data[section] === 'object') {
        custom[section] = { ...(custom[section] ?? {}), ...foundry.utils.duplicate(data[section]) };
      }
    }
    for (const type of ['trap', 'cache']) {
      const list = data.hidden?.[type];
      if (!Array.isArray(list)) continue;
      custom.hidden ??= {};
      custom.hidden[type] = [...new Set([...(custom.hidden[type] ?? []), ...list.map(String)])];
    }
    await this.automator.saveCustomDefinitions(custom);
    ui.notifications.info('Trap Manager: definitions imported.');
  }
}
