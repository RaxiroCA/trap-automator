# The Horse's Trap Automator

A Foundry VTT module for **D&D 5e** that lets the GM place traps and loot caches in a few clicks. Press a hotkey, answer a short series of questions, draw a tile, and the module:

- stores the trap or cache data on the tile,
- for traps, wires the tile to **Monk's Active Tiles** so the trap springs when any token enters it,
- surrounds the tile with four **hint tokens** (above, right, below, left), each one only noticeable by characters whose passive Perception is high enough (via **Stealthy**).

When a trap springs, **Monk's TokenBar** posts a saving throw request to chat for the tokens caught in it. Each player rolls from that card, and the GM rolls for NPCs. Once everyone has rolled, the module rolls the trap's damage and **applies it to each token**: full damage on a failed save, and half on a success if the trap allows it. Resistances and immunities are respected.

The same hint tokens appear around caches, so players have to investigate to tell a blessing from a curse. Each trap and cache has several hint sets, and one is picked at random every time, so players can't memorise what a clue means.

## Requirements

| | Version |
|---|---|
| Foundry VTT | v13 (verified on v14) |
| Game system | D&D 5e |
| [Monk's Active Tile Triggers](https://foundryvtt.com/packages/monks-active-tiles) | required: springs the trap when a token enters the tile |
| [Monk's TokenBar](https://foundryvtt.com/packages/monks-tokenbar) | required: posts the saving throw request that players roll from chat |
| [Stealthy](https://foundryvtt.com/packages/stealthy) | required: hides each hint token from characters whose passive Perception is too low |
| [Item Piles](https://foundryvtt.com/packages/item-piles) | optional: the bundled *Loot* actor is set up as an item pile |

The current releases of Monk's Active Tile Triggers and Monk's TokenBar (14.x) require Foundry v14. On v13, install their last v13-compatible releases.

## Installation

In Foundry's **Add-on Modules → Install Module**, paste this manifest URL:

```
https://raw.githubusercontent.com/RaxiroCA/trap-automator/main/module.json
```

On **The Forge**, install it from the Bazaar. If the module doesn't show up in your world's *Manage Modules* list afterwards, make sure the world is running D&D 5e, update your core/system/modules, then **stop and restart your Forge server** so it picks up the new files.

## First-time setup (do this once per world)

The module needs a few world documents that it ships in its compendiums. Skipping these steps is the most common reason "nothing happens".

1. **Enable the modules.** Turn on *The Horse's Trap Automator*, *Monk's Active Tile Triggers*, *Monk's TokenBar* and *Stealthy* in *Manage Modules*.
2. **Import the hint actors.** In the Compendium sidebar, right-click **The Horse's Actors** → *Import All Content*. This creates `Hint +2`, `Hint +4`, `Hint +6`, `Hint +10` and `Loot` in your Actors tab.
   - Keep these names exactly as they are. The module finds them by name.
   - **Set their token art.** The shipped actors point at an image that isn't included in the module, so they show as a broken image. Open each `Hint +N` actor → *Prototype Token* → *Appearance* and choose any image (for example `icons/svg/eye.svg`). Tokens you spawn afterwards will use it.

You don't need to import any macro.

> **Upgrading from 1.0.7 or earlier?** Trap tiles placed with older versions ran a macro that usually didn't exist in your world. When the GM loads the world, the module switches them to the new TokenBar-based trap automatically.

## Usage

### Open the menu

The default hotkey is **Shift + T** (GM only). To change it, go to *Game Settings → Configure Controls*, find *Open Trap/Cache Automator*, and assign a new key. Avoid browser shortcuts such as Ctrl + T, which opens a new tab in Chrome.

### Create a trap

1. **Trap** → pick a category (and sub-category, if there is one) → pick a trap.
2. Choose where it is: floor, wall, ceiling or other.
3. Choose the trigger, for example "step on a pressure plate".
4. Set the save DC, save ability, damage formula and type, half damage on success, and an optional extra effect.
5. **Draw a tile** on the scene where the trap is (Tiles layer). The module attaches the trigger to that tile and places the four hint tokens around it.

The trap lives on a **Tile** with a Monk's Active Tiles trigger, not on a Scene Region. To inspect or tweak it, open the tile's config and look at the *Triggers* tab that Monk's Active Tiles adds. You'll see a single *Spring Trap* action there.

For the damage type, use a D&D 5e type such as `piercing` or `fire` so resistances and immunities apply. Anything else is applied as untyped damage.

### Create a cache

Same flow: **Cache** → pick a type → location → optional description → draw a tile. Caches only place hint tokens and store their data on the tile. They never spring.

### What happens when a trap is triggered

When **any token** (player character, NPC or a token the GM moves) enters the tile:

1. A **Monk's TokenBar** saving throw card appears in chat, showing the trap's name and flavour text. The DC is hidden.
2. Each player clicks to roll for their own character, with TokenBar's usual advantage/disadvantage options. The GM rolls for NPCs from the same card.
3. Once every token on the card has rolled, the module rolls the trap's damage once and posts it to chat.
4. That damage is **applied to each token's hit points** (temporary HP first): full damage on a failure, half on a success if *Half damage on success* was ticked, and none otherwise. A summary with each token's success or failure text is posted to chat.

The GM must be viewing the scene when the trap springs, because TokenBar needs the tokens on the GM's canvas.

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
| Token walks over the trap and nothing happens | Check that Monk's Active Tile Triggers and Monk's TokenBar are enabled, that the tile's *Triggers* tab shows an active *Spring Trap* action, and that a GM is logged in and viewing the scene. |
| Roll card appears but no damage is applied | Damage is applied only after **every** token on the card has rolled. Check that the trap has a damage formula; an invalid formula is reported as an error. |
| Damage ignores resistances | The damage type isn't a D&D 5e type, so it was applied as untyped damage. Use `piercing`, `fire` and so on. |

## Credits

Created by **The Horse**. Issues and suggestions are welcome on [GitHub](https://github.com/ryanw341/trap-automator/issues).
