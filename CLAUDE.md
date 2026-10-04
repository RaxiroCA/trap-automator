# CLAUDE.md

Guidance for working on **The Horse's Trap Automator**, a Foundry VTT module for the D&D 5e system. It lets the GM build traps and caches on tiles and places perception-gated hint tokens around them.

## Project at a glance

| Path | What it is |
|---|---|
| `module.json` | Foundry manifest: id `trap-automator`, version, compatibility (min 13, verified 14), packs, required modules. |
| `scripts/trap-automator.js` | **All runtime code.** One `TrapAutomator` class plus `init`/`ready` hooks and the MATT/TokenBar hooks. Plain ES module with no build step and no dependencies. |
| `definitions/builtin-defs.json` | Built-in trap and cache definitions (71 traps, 17 caches), fetched at `ready`. |
| `packs/horses-actors/` | LevelDB compendium: `Hint +2/+4/+6/+10` (npc) and `Loot` (Item Piles actor). |
| `packs/horses-macros/` | LevelDB compendium: `Trap Trigger` (legacy resolution macro, **no longer used**), `Clear Banked Perception`, `Clear Banked Stealth` (Stealthy helpers). |
| `lang/en.json` | Stub. Almost every UI string is hard-coded English in the JS. |

There is no `package.json`, bundler, linter or test suite. What's in the repo ships as-is.

## Runtime flow

1. Load time: `Hooks.on('setupTileActions')` registers the MATT action `trap-automator.spring` ("Spring Trap"). `Hooks.on('monks-tokenbar.updateRoll')` listens for finished roll requests.
2. `init`: `TrapAutomator.registerSettings()` registers `customDefs` (world, Object), creates `game.trapAutomator` and registers the keybinding (default **Shift+T**, GM only).
3. `ready`: fetches `modules/trap-automator/definitions/builtin-defs.json` into `builtinDefs`, then `rebuildDefinitions()` deep-merges it with `customDefs` and fills in the default triggers. Finally, the active GM runs `upgradeTrapTiles()`, which replaces old `runmacro` actions on trap tiles with the Spring Trap action and sets `restriction: 'all'`.
4. Hotkey → `openInitialDialog()` → chain of dialogs (type → category/sub-category → trap → location → trigger → details). The choices build up in `this.currentData`. The details dialogs (`openTrapDetailsDialog` / `openCacheDetailsDialog`) collect the **Detection DC** and per-tier **hint DCs** (`_renderDetectionFields` / `_readDetectionFields`; defaults from `hintDCsFor()`: +2 → DC, +4 → DC+2, +6 → DC+4, +10 → DC+8). For traps they also collect the **attack type**: `save` (ability + DC + half) or `attack` (attack bonus).
5. `promptDrawTile()` registers a one-shot `createTile` hook. `onTileCreated()` then:
   - builds `trapData` (`buildTrapData()`) and writes it to `flags['trap-automator'].trapData`,
   - for traps only, writes `flags['monks-active-tiles']` with an `enter` trigger, `restriction: 'all'` (any token) and a single `trap-automator.spring` action with empty `data`,
   - `spawnHintsAroundTile(tile, hints, hintDCs)` creates **unlinked** tokens from world actors found **by name** (`Hint +2` …), each named after its hint text. Each token's `delta.effects` overrides the actor's Stealthy *Hiding* effect (same `_id`, built by `hintStealthEffect()`) with `flags.stealthy.stealth = <hint DC>`, and the shipped `stealthOnCreate` flags (`min-visibility-distance`, `the-horses-actor-visibility-tools`) are switched off so they don't re-roll it.
6. A token enters the tile. MATT runs the Spring Trap action **on the GM client**, which calls `springTrap(tile, tokens)`. That reads `trapData` from the tile. For `attackType: 'attack'` it calls `resolveTrapAttack()`, which rolls `1d20 + attackBonus` against each actor's `system.attributes.ac.value` (a natural 20 crits with `Roll#alter(2, 0)` to double the dice; a natural 1 misses), applies damage per hit and posts one card; there's no TokenBar involvement. Otherwise (`save`, or legacy data with no `attackType`) it calls `game.MonksTokenBar.requestRoll(tokens, { request: 'save:<ability>', dc, showdc: false, silent: true, fastForward: false, trapAutomator: { tileUuid, trap } })`. A roll card is posted to chat; owners roll from it, and the GM rolls for NPCs.
7. When every token on the card has rolled, TokenBar fires `monks-tokenbar.updateRoll(result, message)`. `onTokenBarRollComplete()` (active GM only, once per message via `flags['trap-automator'].resolved`) reads the trap back from `message.flags['monks-tokenbar'].options.trapAutomator`, then `resolveTrapDamage()` rolls damage once, applies it with dnd5e's `actor.applyDamage([{ value, type, properties }])` (full on fail, half on success if `halfDamageOnSuccess`) and posts a summary.

### Trap data (`flags['trap-automator'].trapData`)

Built by `buildTrapData()`: `name`, `type` (`trap`|`cache`), `flavor`, `detectionDC`, `hintDCs` (`{ '+2': 15, … }`). For traps it also stores `attackType` (`save`|`attack`), `attackBonus` (attack only), `saveType` + `DC`/`hiddenDC` (save only), `damageFormula`, `damageType`, `halfDamageOnSuccess` (save only), `failText` (failed save or hit) and `successText` (successful save or miss). For caches it stores `foundText`. Tiles from before this change have no `attackType`, `detectionDC` or `hintDCs`; treat a missing `attackType` as `save`.

### Definitions schema (`builtin-defs.json` / `customDefs`)

```jsonc
{
  "trap": {
    "<slug>": {
      "name": "…", "category": "<category-or-subcategory>", "defaultSave": "dex", "defaultDC": 10,
      "attackType": "save|attack", "defaultAttackBonus": 5, "defaultDetectionDC": 15,   // all optional
      "description": { "flavor": "…{location}…", "fail": "…", "success": "…" },
      "hints": { "floor|wall|ceiling|other": [ { "+2": "…", "+4": "…", "+6": "…", "+10": "…" } ] }
    }
  },
  "cache": { "<slug>": { "name": "…", "category": "…", "description": { "found": "…" }, "hints": { /* same shape */ } } },
  "triggers": { "<category>": ["step on a pressure plate", …] },   // customDefs only; defaults live in initializeDefaultTriggers()
  "categories": { "<slug>": { "name": "<slug>", "primary": "<parent>" } } // customDefs only
}
```

- The Add/Edit Trap forms read and write the optional defaults with `_renderTrapDefaultsFields` / `_readTrapDefaultsFields`. Nine built-in single-strike traps (turrets, blades, pendulums, snakes) are `attack` at +5; the rest are saves.
- `hints[loc]` may also use a legacy shape, `{ "+2": [..], "+4": [..] }`. Both `getHints()` and the edit forms accept either.
- Primary categories are `generic`, `sci-fi`, `magical`, `natural` and `grimdark`. `categorizeCategory()` maps a category to `{primary, sub}`: first via custom `categories`, then a hard-coded grimdark sub-category list, then regexes, and anything left over becomes `generic` (for example `misc`).
- `{trigger}` and `{location}` placeholders in `flavor` are stripped by `cleanFlavorText()`, and the final text is rebuilt as `You <trigger> <location phrase>. <description>`.

## Conventions

- Match the existing style: 2-space indent, single quotes, JSDoc block on every method, comments that explain *why*.
- Build dialogs with `TrapAutomator.makeDialog(spec)`, which takes the legacy `Dialog` spec shape, renders with `DialogV2` on v13+, and hands callbacks a jQuery-wrapped root so `html.find(...)` keeps working. Don't instantiate `Dialog` or `DialogV2` directly.
- Delegated `$(document).on('…​.taXxx')` handlers must be namespaced and removed with `TrapAutomator.onDialogClose(dlg, …)`.
- Settings namespace and flag scope are always `'trap-automator'`.
- Write custom definitions only through `saveCustomDefinitions()`, which rebuilds live definitions so deletions take effect immediately. Always `foundry.utils.duplicate()` the setting before mutating it.
- Target Foundry **v13 and v14** APIs (`foundry.applications.api.*`, `foundry.utils.*`). Don't use globals that were deprecated in v12 or v13.
- User-facing strings are currently inline English. When touching UI, prefer moving strings into `lang/en.json` with `game.i18n.localize`, but don't mix that into unrelated changes.

## Working with the compendium packs

The packs are LevelDB folders, so they can't be edited as text.

- `.gitattributes` marks `packs/**` as binary. Before it existed, `core.autocrlf=true` turned `CURRENT` into CRLF on Windows checkouts, which makes LevelDB fail to open (`IO error: …MANIFEST-000004`). If a pack won't open, check `od -c packs/*/CURRENT`.
- To read or edit them, use the official CLI from a scratch directory rather than adding Node tooling to the repo: `npx @foundryvtt/foundryvtt-cli unpack` / `pack` (or `classic-level` directly). Remove `LOCK` from a copy before opening it.
- Don't commit a pack while Foundry has it open, because the `LOCK`/`LOG` files change.
- Document IDs: Trap Trigger is `U9VWVLlOLaA23jqP`; the hint actors are `s2sh85ilXdllJLYj` (+2), `hi5l2m7NaATD44qn` (+4), `21VYtO8FKiD3KCLo` (+6) and `Yf8XSJM2v9mv6PA9` (+10).

## Testing

There are no automated tests. Test manually in Foundry:

1. Symlink or copy the repo into `{FoundryData}/Data/modules/trap-automator` (the folder name must match the module id).
2. Use a D&D 5e world with Monk's Active Tile Triggers, Monk's TokenBar and Stealthy enabled, and import the hint actors.
3. Press Shift+T, create a trap, draw a tile, and check the tile flags (`canvas.tiles.controlled[0].document.flags`) and the four hint tokens.
4. Move a token onto the tile (any token works). Roll from the TokenBar card (log in as a player in a second window to test the player side), and check that HP drops and the summary is posted.
5. Useful console handles: `game.trapAutomator`, `game.trapAutomator.definitions`, `game.settings.get('trap-automator','customDefs')`.

To check syntax without Foundry, run `node --check scripts/trap-automator.js`. To validate the JSON, run `node -e "require('./definitions/builtin-defs.json')"`.

## Releasing

1. Bump `version` in `module.json` and update `download` to `…/archive/refs/tags/v<version>.zip`.
2. Leave `manifest` on the **main branch raw URL**. It must not be tag-pinned, or installed copies can never see an update (see commit `aaaec0d`).
3. Commit, tag `v<version>` and push the tag (and create a GitHub release).

## Git remotes

- `origin` is the fork, `RaxiroCA/trap-automator`. Push branches here and open PRs from here.
- `upstream` is the original, `ryanw341/trap-automator`.
- **Releases are published from the fork** (since v1.0.8). `module.json`'s `manifest` and `download` URLs, and the README install URL, point at `RaxiroCA/trap-automator`.

## Monk's Active Tiles / TokenBar / Stealthy integration notes

Verified against the MATT and TokenBar sources (both v14.01), the Stealthy source (v14.0.0) and dnd5e `actor.mjs`:

- **MATT trigger flags** live at `flags['monks-active-tiles']`. Token restriction is `restriction: 'gm' | 'player'`, and any other value means no restriction. There is no `restrictedTokens` key (older versions of this module wrote one, and MATT ignored it).
- **Custom actions:** register them in the `setupTileActions` hook with `app.registerTileGroup(ns, name)` / `app.registerTileAction(ns, key, { name, ctrls, fn, content })`. `ns` must be an installed module id. MATT calls the hook with `Hooks.call` during its setup, so register the listener at load time. Tile actions run on the GM: player clients forward the trigger over a socket, and only `game.user.isTheGM` executes it. `fn` receives `{ tile, tokens, action, ... }`, where `tokens` are TokenDocuments.
- **TokenBar** `requestRoll(tokens, options)` needs canvas `Token` placeables (or actors), so the GM must be viewing the trap's scene. With `silent: true`, it posts the chat card directly instead of opening the request dialog. `options` (including our `trapAutomator` key) is stored at `message.flags['monks-tokenbar'].options`. `options.callback` only lives in memory, so it's lost on reload; we use the hook instead.
- **`monks-tokenbar.updateRoll`** fires on GM clients whenever the message is updated after all tokens have rolled, so it can fire more than once. `tokenresults[]` has `{ uuid (TokenDocument), passed, roll, name, actor }`.
- **Stealthy** (v14.0.0, dnd5e engine) finds a token's stealth on the first enabled effect with `flags.stealthy.stealth` (or a name in its hidden aliases). A viewer sees the token when its perception value is **greater than** the stealth value; with no banked Perception, the value is passive Perception + 1, so passive Perception ≥ DC sees it. A banked active Perception roll is never lower than passive.
- **dnd5e** `applyDamage(damages, options)` takes `DamageDescription[]` (`{ value, type, properties: Set }`) and applies resistances, immunities and temporary HP. A plain number skips resistances.
- MATT 14.x and TokenBar 14.x require Foundry v14. v13 users need older releases of both.

## Known issues / backlog

These were found while debugging a real install (see `old-ai-chat.txt`, a transcript with another assistant; much of its advice was wrong, so don't treat it as documentation).

1. **Hint actors have broken art.** Their `img` and `prototypeToken.texture.src` point to `tokenizer/npc-images/hint_2.*.webp`, a file in the author's world that isn't shipped. Ship an image in the module (or use a core icon) and repack.
2. **Hint actors must be imported by hand.** `spawnHintsAroundTile()` uses `game.actors.getName('Hint +N')`. Consider importing them on first use, or creating tokens straight from the compendium.
3. **The legacy Trap Trigger macro is still in the macro compendium.** Nothing uses it any more. Remove it the next time the pack is repacked (backlog #1).
4. **Hint +2 has no Stealthy "Hiding" effect** (the other three do), so it's probably visible to everyone. Check whether that's intended.
5. **Traps don't fire off-scene.** TokenBar needs canvas tokens, so if no GM is viewing the scene, `springTrap` only warns. A fallback could request rolls by actor.
6. **Delegated jQuery handlers leak.** `openAddCacheDialog` and `openAddTrapDialog` attach `$(document)` handlers without `onDialogClose` cleanup. They `.off()` before `.on()`, so they don't stack, but they outlive the dialog.
7. **Unescaped HTML.** Definition text is interpolated into HTML without escaping (for example `value="${def.name}"`), so a quote in a name breaks the form. Use `foundry.utils.escapeHTML` or equivalent.
