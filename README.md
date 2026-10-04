# The Horse's Trap Automator

A Foundry VTT module for **D&D 5e** that lets the GM place traps and loot caches in a few clicks. Press a hotkey, answer a short series of questions, draw a tile, and the module:

- stores the trap or cache data on the tile,
- for traps, wires the tile to **Monk's Active Tiles** so it runs the *Trap Trigger* macro when a player token enters it,
- surrounds the tile with four **hint tokens** (above, right, below, left), each one only noticeable by characters whose passive Perception is high enough (via **Stealthy**).

The same hint tokens appear around caches, so players have to investigate to tell a blessing from a curse. Each trap and cache has several hint sets, and one is picked at random every time, so players can't memorise what a clue means.

> **What it automates and what it doesn't**
> The module automates *map prep*: the tile, its trigger and the perception-gated hints. When a trap fires, the bundled macro asks the player to roll the save (with advantage/disadvantage and a flat bonus), compares it to the hidden DC, and posts the result and damage formula to chat. **It does not apply damage to the character sheet**; the GM applies it.

## Requirements

| | Version |
|---|---|
| Foundry VTT | v13 (verified on v14) |
| Game system | D&D 5e |
| [Monk's Active Tile Triggers](https://foundryvtt.com/packages/monks-active-tiles) | required: fires the macro when a token enters the tile |
| [Stealthy](https://foundryvtt.com/packages/stealthy) | required: hides each hint token from characters whose passive Perception is too low |
| [Item Piles](https://foundryvtt.com/packages/item-piles) | optional: the bundled *Loot* actor is set up as an item pile |

## Installation

In Foundry's **Add-on Modules → Install Module**, paste this manifest URL:

```
https://raw.githubusercontent.com/ryanw341/trap-automator/main/module.json
```

On **The Forge**, install it from the Bazaar. If the module doesn't show up in your world's *Manage Modules* list afterwards, make sure the world is running D&D 5e, update your core/system/modules, then **stop and restart your Forge server** so it picks up the new files.

## First-time setup (do this once per world)

The module needs a few world documents that it ships in its compendiums. Skipping these steps is the most common reason "nothing happens".

1. **Enable the modules.** Turn on *The Horse's Trap Automator*, *Monk's Active Tile Triggers* and *Stealthy* in *Manage Modules*.
2. **Import the hint actors.** In the Compendium sidebar, right-click **The Horse's Actors** → *Import All Content*. This creates `Hint +2`, `Hint +4`, `Hint +6`, `Hint +10` and `Loot` in your Actors tab.
   - Keep these names exactly as they are. The module finds them by name.
   - **Set their token art.** The shipped actors point at an image that isn't included in the module, so they show as a broken image. Open each `Hint +N` actor → *Prototype Token* → *Appearance* and choose any image (for example `icons/svg/eye.svg`). Tokens you spawn afterwards will use it.
You don't need to import any macro. Traps run the *Trap Trigger* macro straight from the module's **The Horse's Macros** compendium, so keep that compendium visible to players (the default). To use your own macro instead, press the hotkey, choose **Select Macro** and pick it; choose *Trap Trigger (bundled with module)* to switch back.

> Upgrading from 1.0.7 or earlier? Trap tiles placed with older versions pointed at a macro that didn't exist and fired for any token. When the GM loads the world, the module repairs them automatically.

## Usage

### Open the menu

The default hotkey is **Shift + T** (GM only). To change it, go to *Game Settings → Configure Controls*, find *Open Trap/Cache Automator*, and assign a new key. Avoid browser shortcuts such as Ctrl + T, which opens a new tab in Chrome.

### Create a trap

1. **Trap** → pick a category (and sub-category, if there is one) → pick a trap.
2. Choose where it is: floor, wall, ceiling or other.
3. Choose the trigger, for example "step on a pressure plate".
4. Set the save DC, save ability, damage formula and type, half damage on success, and an optional extra effect.
5. **Draw a tile** on the scene where the trap is (Tiles layer). The module attaches the trigger to that tile and places the four hint tokens around it.

The trap lives on a **Tile** with a Monk's Active Tiles trigger, not on a Scene Region. To inspect or tweak it, open the tile's config and look at the *Triggers* tab that Monk's Active Tiles adds.

### Create a cache

Same flow: **Cache** → pick a type → location → optional description → draw a tile. Caches only place hint tokens and store their data on the tile. They never run a macro.

### What happens when a trap is triggered

When a **player-owned token** moves into the tile:

1. Monk's Active Tiles runs the *Trap Trigger* macro for that player.
2. The player sees the trap's flavour text and chooses normal, advantage or disadvantage plus any flat bonus.
3. The save is rolled against the hidden DC, and the result is posted to chat with the success or failure text and, on a failure, the damage formula to apply.

NPC tokens don't set off traps. To test as GM, move a token that a player owns, or log in as a player in a second browser window.

### Hint tokens

- `Hint +2`, `Hint +4`, `Hint +6` and `Hint +10` are the four difficulty tiers; the higher the number, the more revealing the clue.
- Each token is named after its clue text and shows the name on hover, so a player who can see the token can read the clue.
- Whether a player can see a hint is handled by Stealthy, based on the hint actor's Stealth against the character's passive Perception.

### Custom definitions

From the main menu you can also:

- **Add Definition**: add a category, sub-category, trigger phrase, trap or cache. Traps and caches can have several hint sets, and one is chosen at random each time.
- **Edit Definitions**: change or delete them. Editing a built-in trap or cache saves a custom copy that overrides it; only custom entries can be deleted.

Custom definitions are saved in the world, so they survive restarts and module updates.

## Built-in content

- **71 traps** across Sci-Fi, Natural, Misc (shown under Generic) and a Grimdark family with the sub-categories Imperial, Space Elves, Cyborgs, Greenskins and Biohorrors.
- **17 caches**, from ammo caches and data-slate archives to buried stashes and hidden paths.
- Every trap and cache has hint sets for floor, wall, ceiling and other.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Module missing from *Manage Modules* | The world isn't D&D 5e, Foundry is older than v13, or (on the Forge) the server needs a restart. |
| Hotkey does nothing | Make sure you are the GM and the canvas has focus. Check the binding in *Configure Controls*. |
| `No actor named "Hint +N" found` | Import **The Horse's Actors** compendium (setup step 2) and keep the actor names unchanged. |
| Hint tokens show a broken image | Set the hint actors' prototype token image (setup step 2). |
| Token walks over the trap and nothing happens | Check that Monk's Active Tile Triggers is enabled, test with a player-owned token, and make sure players can see *The Horse's Macros* compendium. If you picked a custom macro with **Select Macro**, check that it still exists. |
| Damage isn't applied | Expected. The macro posts the damage formula to chat; the GM applies it. |

## Credits

Created by **The Horse**. Issues and suggestions are welcome on [GitHub](https://github.com/ryanw341/trap-automator/issues).
