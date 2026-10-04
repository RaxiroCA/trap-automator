# CLAUDE.md

Guidance for working on **The Horse's Trap Automator**, a Foundry VTT module for the D&D 5e system. It lets the GM build traps and caches on tiles and places perception-gated hint tokens around them.

## Project at a glance

| Path | What it is |
|---|---|
| `module.json` | Foundry manifest: id `trap-automator`, version, compatibility (min 13, verified 14), packs, required modules. |
| `scripts/trap-automator.js` | **All runtime code.** One `TrapAutomator` class plus `init` and `ready` hooks. Plain ES module with no build step and no dependencies. |
| `definitions/builtin-defs.json` | Built-in trap and cache definitions (71 traps, 17 caches), fetched at `ready`. |
| `packs/horses-actors/` | LevelDB compendium: `Hint +2/+4/+6/+10` (npc) and `Loot` (Item Piles actor). |
| `packs/horses-macros/` | LevelDB compendium: `Trap Trigger` (resolution macro), `Clear Banked Perception`, `Clear Banked Stealth` (Stealthy helpers). |
| `lang/en.json` | Stub. Almost every UI string is hard-coded English in the JS. |

There is no `package.json`, bundler, linter or test suite. What's in the repo ships as-is.

## Runtime flow

1. `init`: `TrapAutomator.registerSettings()` registers `customDefs` (world, Object) and `macroId` (world, String), creates `game.trapAutomator` and registers the keybinding (default **Shift+T**, GM only).
2. `ready`: fetches `modules/trap-automator/definitions/builtin-defs.json` into `builtinDefs`, then `rebuildDefinitions()` deep-merges it with `customDefs` and fills in the default triggers.
3. Hotkey → `openInitialDialog()` → chain of dialogs (type → category/sub-category → trap → location → trigger → details). The choices build up in `this.currentData`.
4. `promptDrawTile()` registers a one-shot `createTile` hook. `onTileCreated()` then:
   - builds `trapData` (`buildTrapData()`) and writes it to `flags['trap-automator'].trapData`,
   - for traps only, writes `flags['monks-active-tiles']` with an `enter` trigger, `restrictedTokens: 'players'`, and a `runmacro` action whose `args` is the JSON-stringified `trapData` with quotes escaped,
   - `spawnHintsAroundTile()` creates linked tokens from world actors found **by name** (`Hint +2` …), each named after its hint text.
5. The `Trap Trigger` macro (in the compendium, not in the JS) parses `args`, prompts the player for roll mode and bonus, rolls the save and posts the result to chat. It does **not** apply damage.

### Definitions schema (`builtin-defs.json` / `customDefs`)

```jsonc
{
  "trap": {
    "<slug>": {
      "name": "…", "category": "<category-or-subcategory>", "defaultSave": "dex", "defaultDC": 10,
      "description": { "flavor": "…{location}…", "fail": "…", "success": "…" },
      "hints": { "floor|wall|ceiling|other": [ { "+2": "…", "+4": "…", "+6": "…", "+10": "…" } ] }
    }
  },
  "cache": { "<slug>": { "name": "…", "category": "…", "description": { "found": "…" }, "hints": { /* same shape */ } } },
  "triggers": { "<category>": ["step on a pressure plate", …] },   // customDefs only; defaults live in initializeDefaultTriggers()
  "categories": { "<slug>": { "name": "<slug>", "primary": "<parent>" } } // customDefs only
}
```

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
2. Use a D&D 5e world with Monk's Active Tile Triggers and Stealthy enabled, and import the two compendiums.
3. Press Shift+T, create a trap, draw a tile, and check the tile flags (`canvas.tiles.controlled[0].document.flags`) and the four hint tokens.
4. Log in as a player in a second browser window (or move a player-owned token) to fire the trigger.
5. Useful console handles: `game.trapAutomator`, `game.trapAutomator.definitions`, `game.settings.get('trap-automator','customDefs')`.

To check syntax without Foundry, run `node --check scripts/trap-automator.js`. To validate the JSON, run `node -e "require('./definitions/builtin-defs.json')"`.

## Releasing

1. Bump `version` in `module.json` and update `download` to `…/archive/refs/tags/v<version>.zip`.
2. Leave `manifest` on the **main branch raw URL**. It must not be tag-pinned, or installed copies can never see an update (see commit `aaaec0d`).
3. Commit, tag `v<version>` and push the tag (and create a GitHub release).

## Git remotes

- `origin` is the fork, `RaxiroCA/trap-automator`. Push branches here and open PRs from here.
- `upstream` is the original, `ryanw341/trap-automator`. `module.json`'s `manifest` and `download` URLs still point here. Only change them if the fork starts publishing its own releases.

## Known issues / backlog

These were found while debugging a real install (see `old-ai-chat.txt`, a transcript with another assistant; much of its advice was wrong, so don't treat it as documentation).

1. **Traps never fire out of the box.** The `macroId` setting defaults to `Macro.z9RXNw9fEKBIkxHW`, which exists in no one's world. The compendium macro is `U9VWVLlOLaA23jqP`, and importing it creates a new world ID anyway. Users must run *Select Macro* by hand. Fix idea: on `ready` (GM), find or import the compendium macro and store its UUID, or resolve the trigger macro at runtime.
2. **Hint actors have broken art.** Their `img` and `prototypeToken.texture.src` point to `tokenizer/npc-images/hint_2.*.webp`, a file in the author's world that isn't shipped. Ship an image in the module (or use a core icon) and repack.
3. **Hint actors must be imported by hand.** `spawnHintsAroundTile()` uses `game.actors.getName('Hint +N')`. Consider importing them on first use, or creating tokens straight from the compendium.
4. **The Trap Trigger macro is out of date.** It uses the ApplicationV1 `Dialog` (deprecated in v13) and `roll.evaluate({ async: true })` (an obsolete option since v12). It doesn't use dnd5e's own save roll (`actor.rollSavingThrow`), so it ignores the system's bonuses and effects, and it doesn't apply damage. Because its code lives only in the LevelDB pack, consider moving it into the JS (for example `game.trapAutomator.resolveTrap(token, data)`) so it can be versioned and reviewed.
5. **Hint +2 has no Stealthy "Hiding" effect** (the other three do), so it's probably visible to everyone. Check whether that's intended.
6. **`module.json` doesn't declare the dnd5e system** in `relationships.systems`, even though the packs are dnd5e-only.
7. **Delegated jQuery handlers leak.** `openAddCacheDialog` and `openAddTrapDialog` attach `$(document)` handlers without `onDialogClose` cleanup. They `.off()` before `.on()`, so they don't stack, but they outlive the dialog.
8. **Unescaped HTML.** Definition text is interpolated into HTML without escaping (for example `value="${def.name}"`), so a quote in a name breaks the form. Use `foundry.utils.escapeHTML` or equivalent.
