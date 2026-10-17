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
 *
 * The window has two parts that scroll independently: the sidebar (type
 * tabs, search, filters, list) and the editor. Selecting, hiding, searching
 * and filtering update the sidebar in place so the list never jumps; only
 * the editor re-renders when its content changes.
 */

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const MODULE_ID = 'trap-automator';
const TIERS = ['+2', '+4', '+6', '+10'];
const LOCATIONS = ['floor', 'wall', 'ceiling', 'other'];
const SAVES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SAVE_LABELS = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const PRIMARY_CATEGORIES = ['generic', 'sci-fi', 'magical', 'natural', 'grimdark'];
const STATUS = {
  builtin: { label: 'Built-in', icon: 'fa-book', tip: 'Ships with the module' },
  modified: { label: 'Modified', icon: 'fa-pen', tip: 'Built-in with your changes' },
  custom: { label: 'Custom', icon: 'fa-star', tip: 'Created by you' }
};
const CATEGORY_ICONS = {
  generic: 'fa-gears',
  'sci-fi': 'fa-robot',
  magical: 'fa-hat-wizard',
  natural: 'fa-tree',
  grimdark: 'fa-skull'
};
// What each hint tier is for, shown next to its input.
const TIER_HINTS = {
  '+2': 'A vague first impression',
  '+4': 'Something is clearly off',
  '+6': 'Points at the mechanism',
  '+10': 'Gives the trap away'
};
// D&D 5e typical difficulty classes, drawn on the DC ladder.
const DC_SCALE = { min: 5, max: 30 };
const DC_BANDS = [
  { dc: 10, label: 'Easy' },
  { dc: 15, label: 'Medium' },
  { dc: 20, label: 'Hard' },
  { dc: 25, label: 'Very hard' },
  { dc: 30, label: 'Nearly impossible' }
];

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
    // Sidebar view state, kept across re-renders.
    this.filter = '';
    this.statusFilter = 'all';
    this.collapsed = new Set();
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
    position: { width: 1040, height: 760 },
    actions: {
      switchType: TrapManager.#onSwitchType,
      selectEntry: TrapManager.#onSelectEntry,
      newEntry: TrapManager.#onNewEntry,
      duplicateEntry: TrapManager.#onDuplicateEntry,
      addSet: TrapManager.#onAddSet,
      duplicateSet: TrapManager.#onDuplicateSet,
      removeSet: TrapManager.#onRemoveSet,
      stepField: TrapManager.#onStepField,
      saveEntry: TrapManager.#onSaveEntry,
      deleteEntry: TrapManager.#onDeleteEntry,
      revertEntry: TrapManager.#onRevertEntry,
      toggleHidden: TrapManager.#onToggleHidden,
      setStatusFilter: TrapManager.#onSetStatusFilter,
      clearSearch: TrapManager.#onClearSearch,
      exportDefs: TrapManager.#onExport,
      importDefs: TrapManager.#onImport
    }
  };

  static PARTS = {
    sidebar: {
      template: 'modules/trap-automator/templates/trap-manager-sidebar.hbs',
      scrollable: ['.ta-list']
    },
    editor: {
      template: 'modules/trap-automator/templates/trap-manager-editor.hbs',
      scrollable: ['.ta-editor-scroll']
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
   * List every definition of a type, built-in and custom, with its status.
   * Hidden entries are included (they can be unhidden).
   * @param {'trap'|'cache'} [type] Defaults to the current tab
   * @returns {Array<{key, name, category, status, hidden, def}>}
   */
  _entries(type = this.type) {
    const builtin = this.automator.builtinDefs?.[type] ?? {};
    const custom = this._readCustom();
    const customDefs = custom[type] ?? {};
    const hidden = new Set(custom.hidden?.[type] ?? []);
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
      sets: sets.length ? sets : [TrapManager.emptySet()]
    };
  }

  /** @returns {Object<string, string>} A hint set with all four tiers empty */
  static emptySet() {
    return Object.fromEntries(TIERS.map(t => [t, '']));
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
   * Font Awesome icon for a category, based on its primary category.
   * @param {string} category
   * @returns {string}
   */
  _categoryIcon(category) {
    if (!category || category === 'misc') return 'fa-shapes';
    const { primary } = this.automator.categorizeCategory(category);
    return CATEGORY_ICONS[primary] ?? 'fa-folder';
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
   * The sentence players read when this trap springs, using the first
   * trigger of its category and the floor location as an example.
   * @param {Object} draft
   * @returns {{text: string, trigger: string}}
   */
  _previewFlavor(draft) {
    const triggers = this.automator.definitions?.triggers ?? {};
    const { primary, sub } = this.automator.categorizeCategory(draft.category || 'generic');
    const list = triggers[sub] ?? triggers[primary] ?? triggers.generic ?? [];
    const trigger = list[0] ?? 'step on a pressure plate';
    return { text: this.automator.composeFlavor(draft.description?.flavor, trigger, 'floor'), trigger };
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

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const TA = this.automator.constructor;
    const fmt = TA.formatLabel;
    const entries = this._entries();

    // Sidebar: tabs, filters and the list grouped by category.
    const statusCounts = { all: entries.length, builtin: 0, modified: 0, custom: 0, hidden: 0 };
    for (const e of entries) {
      statusCounts[e.status]++;
      if (e.hidden) statusCounts.hidden++;
    }
    const groups = new Map();
    for (const entry of entries) {
      if (!groups.has(entry.category)) groups.set(entry.category, []);
      groups.get(entry.category).push(this._rowContext(entry));
    }
    const sortedGroups = [...groups.entries()]
      .map(([category, items]) => ({
        category,
        label: fmt(category),
        icon: this._categoryIcon(category),
        count: items.length,
        open: !this.collapsed.has(category),
        items
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const filters = [
      { id: 'all', label: 'All', icon: 'fa-layer-group' },
      { id: 'builtin', label: STATUS.builtin.label, icon: STATUS.builtin.icon },
      { id: 'modified', label: STATUS.modified.label, icon: STATUS.modified.icon },
      { id: 'custom', label: STATUS.custom.label, icon: STATUS.custom.icon },
      { id: 'hidden', label: 'Hidden', icon: 'fa-eye-slash' }
    ].map(f => ({ ...f, count: statusCounts[f.id], active: this.statusFilter === f.id }));

    return Object.assign(context, {
      isTrap: this.type === 'trap',
      typeLabel: this.type === 'trap' ? 'trap' : 'cache',
      typeTitle: this.type === 'trap' ? 'Trap' : 'Cache',
      tabs: [
        { type: 'trap', label: 'Traps', icon: 'fa-skull-crossbones', count: this._entries('trap').length, active: this.type === 'trap' },
        { type: 'cache', label: 'Caches', icon: 'fa-box-open', count: this._entries('cache').length, active: this.type === 'cache' }
      ],
      filter: this.filter,
      filters,
      groups: sortedGroups,
      categories: this._knownCategories().map(c => ({ value: c, label: fmt(c) })),
      editor: this.draft ? this._editorContext(entries) : null,
      dirty: this.dirty
    });
  }

  /**
   * Context for one list row.
   * @param {Object} entry From _entries()
   * @returns {Object}
   */
  _rowContext(entry) {
    const isTrap = this.type === 'trap';
    const isAttack = entry.def.attackType === 'attack';
    const save = String(entry.def.defaultSave || 'dex').toUpperCase();
    return {
      key: entry.key,
      name: entry.name,
      status: entry.status,
      statusLabel: STATUS[entry.status].label,
      statusIcon: STATUS[entry.status].icon,
      statusTip: STATUS[entry.status].tip,
      hidden: entry.hidden,
      selected: entry.key === this.selectedKey,
      kindIcon: isTrap ? (isAttack ? 'fa-crosshairs' : 'fa-shield-halved') : 'fa-gem',
      kindTip: isTrap ? (isAttack ? `Attack roll (+${Number(entry.def.defaultAttackBonus ?? 5)} vs AC)` : `${save} saving throw`) : 'Cache',
      search: `${entry.name} ${entry.category} ${entry.key}`.toLowerCase()
    };
  }

  /**
   * Context for the editor part.
   * @param {Object[]} entries From _entries()
   * @returns {Object}
   */
  _editorContext(entries) {
    const TA = this.automator.constructor;
    const draft = this.draft;
    const entry = entries.find(e => e.key === draft.key);
    const status = entry?.status ?? 'new';
    const hintDCs = TA.hintDCsFor(draft.defaultDetectionDC);
    const isAttack = draft.attackType === 'attack';
    const pct = dc => Math.max(0, Math.min(100, ((dc - DC_SCALE.min) / (DC_SCALE.max - DC_SCALE.min)) * 100));
    const sets = draft.sets.map((set, index) => {
      const tiers = TIERS.map((tier, level) => ({
        tier,
        level,
        value: set[tier] ?? '',
        filled: !!String(set[tier] ?? '').trim(),
        dc: hintDCs[tier],
        purpose: TIER_HINTS[tier],
        field: `sets.${index}.${tier}`,
        id: `ta-set-${index}-${tier.slice(1)}`
      }));
      const filledCount = tiers.filter(t => t.filled).length;
      return {
        index,
        number: index + 1,
        canRemove: draft.sets.length > 1,
        filledCount,
        fillPct: (filledCount / TIERS.length) * 100,
        state: filledCount === TIERS.length ? 'complete' : (filledCount ? 'partial' : 'empty'),
        tiers
      };
    });
    const preview = this._previewFlavor(draft);
    return {
      ...draft,
      isNew: !draft.key,
      status,
      statusLabel: STATUS[status]?.label ?? 'New',
      statusIcon: STATUS[status]?.icon ?? 'fa-wand-magic-sparkles',
      hidden: !!entry?.hidden,
      canDelete: status === 'custom',
      canRevert: status === 'modified',
      canHide: !!entry,
      canDuplicate: !!entry,
      isAttack,
      categoryIcon: this._categoryIcon(draft.category),
      categoryLabel: draft.category ? TA.formatLabel(draft.category) : 'No category',
      mechanicSummary: this.type === 'trap'
        ? (isAttack ? `+${draft.defaultAttackBonus} to hit vs AC` : `DC ${draft.defaultDC} ${String(draft.defaultSave).toUpperCase()} save`)
        : null,
      saveOptions: SAVES.map(s => ({ value: s, label: `${s.toUpperCase()} · ${SAVE_LABELS[s]}`, selected: s === draft.defaultSave })),
      ladder: {
        bands: DC_BANDS.map(b => ({ ...b, pos: pct(b.dc) })),
        markers: TIERS.map((tier, level) => ({ tier, level, dc: hintDCs[tier], pos: pct(hintDCs[tier]) })),
        detectionPos: pct(draft.defaultDetectionDC)
      },
      preview: preview.text,
      previewTrigger: preview.trigger,
      sets,
      issues: this._buildDefinition(draft).errors
    };
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Ctrl/Cmd+S saves the entry being edited.
    this.element.addEventListener('keydown', ev => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && this.draft) {
        ev.preventDefault();
        ev.stopPropagation();
        TrapManager.#onSaveEntry.call(this);
      }
    });
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const parts = options.parts ?? Object.keys(this.constructor.PARTS);
    if (parts.includes('sidebar')) this._activateSidebar();
    if (parts.includes('editor')) this._activateEditor();
  }

  /** @returns {HTMLElement|null} */
  get _sidebarEl() {
    return this.element?.querySelector('.ta-sidebar') ?? null;
  }

  /** @returns {HTMLElement|null} */
  get _editorEl() {
    return this.element?.querySelector('.ta-editor') ?? null;
  }

  /** Wire up the sidebar's search, filters and collapsible groups. */
  _activateSidebar() {
    const root = this._sidebarEl;
    if (!root) return;
    const search = root.querySelector('.ta-search input');
    search?.addEventListener('input', ev => {
      this.filter = ev.target.value;
      this._applyFilters();
    });
    for (const group of root.querySelectorAll('details.ta-group')) {
      group.addEventListener('toggle', () => {
        if (group.open) this.collapsed.delete(group.dataset.category);
        else this.collapsed.add(group.dataset.category);
      });
    }
    this._applyFilters();
  }

  /**
   * Show only the rows that match the search text and status filter, and
   * hide groups with nothing left. Runs in place, without re-rendering.
   */
  _applyFilters() {
    const root = this._sidebarEl;
    if (!root) return;
    const q = this.filter.trim().toLowerCase();
    const status = this.statusFilter;
    let visible = 0;
    for (const row of root.querySelectorAll('.ta-row')) {
      const matchText = !q || row.dataset.search.includes(q);
      const matchStatus = status === 'all'
        || (status === 'hidden' ? row.classList.contains('is-hidden') : row.dataset.status === status);
      row.hidden = !(matchText && matchStatus);
      if (!row.hidden) visible++;
    }
    for (const group of root.querySelectorAll('.ta-group')) {
      const shown = group.querySelectorAll('.ta-row:not([hidden])').length;
      group.hidden = shown === 0;
      const count = group.querySelector('.ta-group-count');
      if (count) count.textContent = String(shown);
      // Open groups while searching so matches are visible.
      if (q && shown) group.open = true;
    }
    const empty = root.querySelector('.ta-list-empty');
    if (empty) empty.hidden = visible > 0;
    const clear = root.querySelector('.ta-search-clear');
    if (clear) clear.hidden = !q;
    for (const chip of root.querySelectorAll('.ta-chip[data-status]')) {
      chip.classList.toggle('active', chip.dataset.status === status);
      chip.setAttribute('aria-pressed', String(chip.dataset.status === status));
    }
  }

  /**
   * Update one list row and the filter counts after hiding or unhiding it,
   * leaving the row where it is.
   * @param {string} key
   * @param {boolean} hidden
   */
  _updateRowHidden(key, hidden) {
    const root = this._sidebarEl;
    const row = root?.querySelector(`.ta-row[data-key="${CSS.escape(key)}"]`);
    if (row) {
      row.classList.toggle('is-hidden', hidden);
      const eye = row.querySelector('.ta-row-eye');
      if (eye) {
        eye.classList.toggle('is-active', hidden);
        eye.setAttribute('aria-pressed', String(hidden));
        eye.dataset.tooltip = hidden ? 'Hidden from the placement menus. Click to show it again.' : 'Shown in the placement menus. Click to hide it.';
        eye.setAttribute('aria-label', hidden ? 'Show when placing' : 'Hide when placing');
        const icon = eye.querySelector('i');
        if (icon) icon.className = `fas ${hidden ? 'fa-eye-slash' : 'fa-eye'}`;
      }
      const tag = row.querySelector('.ta-row-hidden-tag');
      if (tag) tag.hidden = !hidden;
    }
    const hiddenCount = root?.querySelectorAll('.ta-row.is-hidden').length ?? 0;
    const chipCount = root?.querySelector('.ta-chip[data-status="hidden"] .ta-chip-count');
    if (chipCount) chipCount.textContent = String(hiddenCount);
    this._applyFilters();
  }

  /** Mark the selected row in the list without re-rendering it. */
  _updateRowSelection() {
    const root = this._sidebarEl;
    if (!root) return;
    for (const row of root.querySelectorAll('.ta-row')) {
      const selected = row.dataset.key === this.selectedKey;
      row.classList.toggle('selected', selected);
      row.querySelector('.ta-row-main')?.setAttribute('aria-current', selected ? 'true' : 'false');
    }
  }

  /** Wire up the editor's inputs so edits flow into the draft and the live feedback. */
  _activateEditor() {
    const root = this._editorEl;
    if (!root || !this.draft) return;
    for (const input of root.querySelectorAll('[data-field]')) {
      const read = el => (el.dataset.dtype === 'Number' ? (el.value === '' ? '' : Number(el.value)) : el.value);
      input.addEventListener('input', ev => {
        const el = ev.target;
        if (el.type === 'radio' && !el.checked) return;
        foundry.utils.setProperty(this.draft, el.dataset.field, read(el));
        this._markDirty();
        this._liveUpdate(el);
      });
      input.addEventListener('change', ev => {
        const el = ev.target;
        if (el.type === 'radio' && !el.checked) return;
        foundry.utils.setProperty(this.draft, el.dataset.field, read(el));
        // These change what the editor shows (fields, DCs, summary), so redraw it.
        if (['attackType', 'defaultDetectionDC', 'defaultDC', 'defaultAttackBonus', 'defaultSave', 'category'].includes(el.dataset.field)) {
          this.render({ parts: ['editor'] });
        }
      });
    }
  }

  /** Flag unsaved changes in the editor footer and header. */
  _markDirty() {
    if (this.dirty) return;
    this.dirty = true;
    const root = this._editorEl;
    root?.classList.add('is-dirty');
    const status = root?.querySelector('.ta-save-state');
    if (status) {
      status.innerHTML = '<i class="fas fa-circle-exclamation"></i> Unsaved changes';
      status.dataset.state = 'dirty';
    }
  }

  /**
   * Refresh the parts of the editor that depend on what was just typed:
   * the title, the flavour preview and the hint-set completeness markers.
   * @param {HTMLElement} el The input that changed
   */
  _liveUpdate(el) {
    const root = this._editorEl;
    const field = el.dataset.field;
    if (field === 'name') {
      const title = root.querySelector('.ta-hero-title');
      if (title) title.textContent = this.draft.name || `New ${this.type}`;
    } else if (field === 'description.flavor') {
      const preview = root.querySelector('.ta-preview-text');
      if (preview) preview.textContent = this._previewFlavor(this.draft).text || 'Write a description to see what players will read.';
    } else if (field.startsWith('sets.')) {
      const tierRow = el.closest('.ta-tier');
      tierRow?.classList.toggle('is-filled', !!el.value.trim());
      const setEl = el.closest('.ta-set');
      if (setEl) {
        const filled = setEl.querySelectorAll('.ta-tier.is-filled').length;
        setEl.dataset.state = filled === TIERS.length ? 'complete' : (filled ? 'partial' : 'empty');
        const meter = setEl.querySelector('.ta-set-meter-count');
        if (meter) meter.textContent = `${filled}/${TIERS.length}`;
        const bar = setEl.querySelector('.ta-set-meter-fill');
        if (bar) bar.style.width = `${(filled / TIERS.length) * 100}%`;
      }
    }
    this._refreshIssues();
  }

  /** Update the footer's validation summary to match the current draft. */
  _refreshIssues() {
    const root = this._editorEl;
    const box = root?.querySelector('.ta-issues');
    if (!box) return;
    const { errors } = this._buildDefinition(this.draft);
    box.dataset.count = String(errors.length);
    box.hidden = errors.length === 0;
    const label = box.querySelector('.ta-issues-label');
    if (label) label.textContent = `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before saving`;
    const list = box.querySelector('ul');
    if (list) {
      list.replaceChildren(...errors.map(e => {
        const li = document.createElement('li');
        li.textContent = e;
        return li;
      }));
    }
  }

  /**
   * Ask before throwing away unsaved edits.
   * @returns {Promise<boolean>} Whether it's OK to continue
   */
  async _confirmDiscard() {
    if (!this.dirty) return true;
    return DialogV2.confirm({
      window: { title: 'Discard changes?', icon: 'fas fa-triangle-exclamation' },
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
    this.statusFilter = 'all';
    this.render();
  }

  static async #onSelectEntry(event, target) {
    const key = target.closest('[data-key]')?.dataset.key;
    if (!key || key === this.selectedKey || !(await this._confirmDiscard())) return;
    const entry = this._entries().find(e => e.key === key);
    this.selectedKey = key;
    this.draft = this._draftFromDef(key, entry?.def);
    this.dirty = false;
    this._updateRowSelection();
    this.render({ parts: ['editor'] });
  }

  static async #onNewEntry() {
    if (!(await this._confirmDiscard())) return;
    this.selectedKey = null;
    this.draft = this._draftFromDef(null, {});
    this.dirty = true;
    this._updateRowSelection();
    await this.render({ parts: ['editor'] });
    this._editorEl?.querySelector('[data-field="name"]')?.focus();
  }

  static async #onDuplicateEntry() {
    if (!this.draft || !(await this._confirmDiscard())) return;
    const copy = foundry.utils.duplicate(this.draft);
    copy.key = null;
    copy.name = `${copy.name} (copy)`;
    this.selectedKey = null;
    this.draft = copy;
    this.dirty = true;
    this._updateRowSelection();
    await this.render({ parts: ['editor'] });
    this._editorEl?.querySelector('[data-field="name"]')?.select();
  }

  static async #onAddSet() {
    if (!this.draft) return;
    this.draft.sets.push(TrapManager.emptySet());
    this.dirty = true;
    await this.render({ parts: ['editor'] });
    const sets = this._editorEl?.querySelectorAll('.ta-set');
    const last = sets?.[sets.length - 1];
    last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    last?.querySelector('input')?.focus();
  }

  static #onDuplicateSet(event, target) {
    const index = Number(target.closest('[data-set]')?.dataset.set);
    if (!this.draft || !Number.isInteger(index) || !this.draft.sets[index]) return;
    this.draft.sets.splice(index + 1, 0, { ...this.draft.sets[index] });
    this.dirty = true;
    this.render({ parts: ['editor'] });
  }

  static #onRemoveSet(event, target) {
    const index = Number(target.closest('[data-set]')?.dataset.set);
    if (!this.draft || this.draft.sets.length <= 1 || !Number.isInteger(index)) return;
    this.draft.sets.splice(index, 1);
    this.dirty = true;
    this.render({ parts: ['editor'] });
  }

  static #onStepField(event, target) {
    const field = target.dataset.field;
    const input = this._editorEl?.querySelector(`input[data-field="${field}"]`);
    if (!input) return;
    const step = Number(target.dataset.step) || 0;
    const min = input.min === '' ? -Infinity : Number(input.min);
    const max = input.max === '' ? Infinity : Number(input.max);
    input.value = String(Math.max(min, Math.min(max, (Number(input.value) || 0) + step)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  static async #onSaveEntry() {
    if (!this.draft) return;
    if (await this.saveDraft()) this.render();
  }

  static async #onDeleteEntry() {
    const key = this.draft?.key;
    if (!key) return;
    const ok = await DialogV2.confirm({
      window: { title: `Delete ${this.draft.name}?`, icon: 'fas fa-trash' },
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
      window: { title: 'Revert to built-in?', icon: 'fas fa-rotate-left' },
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
    const hidden = !entry.hidden;
    await this.setHidden(key, hidden);
    // Update the row where it is instead of redrawing the list.
    this._updateRowHidden(key, hidden);
    if (key === this.draft?.key) this.render({ parts: ['editor'] });
  }

  static #onSetStatusFilter(event, target) {
    this.statusFilter = target.dataset.status || 'all';
    this._applyFilters();
  }

  static #onClearSearch() {
    this.filter = '';
    const input = this._sidebarEl?.querySelector('.ta-search input');
    if (input) {
      input.value = '';
      input.focus();
    }
    this._applyFilters();
  }

  static #onExport() {
    const custom = this._readCustom();
    foundry.utils.saveDataToFile(JSON.stringify(custom, null, 2), 'text/json', 'trap-automator-definitions.json');
    ui.notifications.info('Trap Manager: your customisations were exported.');
  }

  static async #onImport() {
    const choice = await DialogV2.wait({
      window: { title: 'Import Trap Definitions', icon: 'fas fa-file-import' },
      content: `<p>Choose a file exported from the Trap Manager.</p>
        <div class="form-group"><input type="file" name="file" accept=".json,application/json" /></div>
        <p class="hint"><strong>Merge</strong> adds and updates entries from the file and keeps the rest. <strong>Replace</strong> discards all your current customisations first.</p>`,
      buttons: [
        { action: 'merge', label: 'Merge', icon: 'fas fa-code-merge', default: true, callback: (event, button) => ({ mode: 'merge', file: button.form.elements.file.files[0] }) },
        { action: 'replace', label: 'Replace', icon: 'fas fa-arrows-rotate', callback: (event, button) => ({ mode: 'replace', file: button.form.elements.file.files[0] }) },
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
}
