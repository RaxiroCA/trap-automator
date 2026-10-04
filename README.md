# The Horse's Trap Automator

A Foundry VTT module for **D&D 5e** that lets the GM place traps and loot caches in a few clicks. Press a hotkey, answer a short series of questions, draw a tile, and the module:

- stores the trap or cache data on the tile,
- for traps, wires the tile to **Monk's Active Tiles** so the trap springs when any token enters it,
- surrounds the tile with four **hint tokens** (above, right, below, left), each one only noticeable by characters whose passive Perception is high enough (via **Stealthy**).

Every trap and cache has a **Detection DC**: the passive Perception needed to notice it. The hints start at that DC and get harder from there.

Each trap attacks in one of two ways:

- **Saving throw (vs DC):** **Monk's TokenBar** posts a saving throw request to chat for the tokens caught in it. Each player rolls from that card, and the GM rolls for NPCs.
- **Attack roll (vs AC):** the trap rolls d20 + its attack bonus against each token's Armor Class, the way a dart or blade trap would.

Either way, the module **applies the damage to each token**, respecting resistances and immunities.

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
4. Fill in the **Trap Details**:
   - **Detection DC** (default 15): the passive Perception needed to notice the trap. The four hint DCs are filled in from it (see *Hint tokens*), and you can adjust each one.
   - **Trap attacks with**: *Saving throw (vs DC)*, with the save ability, save DC and optional half damage on a successful save; or *Attack roll (vs AC)*, with the trap's attack bonus (default +5).
   - The damage formula and type, and an optional extra effect.
5. **Draw a tile** on the scene where the trap is (Tiles layer). The module attaches the trigger to that tile and places the four hint tokens around it.

The trap lives on a **Tile** with a Monk's Active Tiles trigger, not on a Scene Region. To inspect or tweak it, open the tile's config and look at the *Triggers* tab that Monk's Active Tiles adds. You'll see a single *Spring Trap* action there.

For the damage type, use a D&D 5e type such as `piercing` or `fire` so resistances and immunities apply. Anything else is applied as untyped damage.

### Create a cache

Same flow: **Cache** → pick a type → location → optional description → draw a tile. Caches only place hint tokens and store their data on the tile. They never spring.

### What happens when a trap is triggered

Any token (player character, NPC or a token the GM moves) that enters the tile springs the trap.

**Saving throw traps**

1. A **Monk's TokenBar** saving throw card appears in chat, showing the trap's name and flavour text. The DC is hidden.
2. Each player clicks to roll for their own character, with TokenBar's usual advantage/disadvantage options. The GM rolls for NPCs from the same card.
3. Once every token on the card has rolled, the module rolls the trap's damage once and posts it to chat.
4. That damage is **applied to each token's hit points** (temporary HP first): full damage on a failure, half on a success if *Half damage on a successful save* was ticked, and none otherwise. A summary with each token's success or failure text is posted to chat.

The GM must be viewing the scene when a saving throw trap springs, because TokenBar needs the tokens on the GM's canvas.

**Attack roll traps**

1. The trap immediately rolls d20 + its attack bonus against each token's AC. Nobody needs to click anything.
2. A roll that meets or beats the AC hits. A natural 20 always hits and is a **critical hit**, with the damage dice doubled. A natural 1 always misses.
3. Each hit rolls its own damage, which is **applied to that token's hit points**. One chat card lists every attack, the AC it was compared to, hit or miss, and the damage.

### Hint tokens

- `Hint +2`, `Hint +4`, `Hint +6` and `Hint +10` are the four tiers; the higher the tier, the more revealing the clue and the harder it is to spot.
- Each tier has its own **DC**, based on the trap's Detection DC: the `+2` hint sits at the Detection DC and the others above it.

  | Hint | DC | With Detection DC 15 |
  |---|---|---|
  | `Hint +2` | Detection DC | 15 |
  | `Hint +4` | Detection DC + 2 | 17 |
  | `Hint +6` | Detection DC + 4 | 19 |
  | `Hint +10` | Detection DC + 8 | 23 |

  You can change any of these in the Trap Details or Cache Details dialog before drawing the tile.
- A character sees a hint when their **passive Perception is at least that hint's DC**. Stealthy handles this; each hint token stores its DC on its own *Hiding* effect.
- Each token is named after its clue text and shows the name on hover, so a player who can see the token can read the clue.
- Hint tokens are not linked to the `Hint +N` actors, so each trap's hints keep their own DCs. To change one later, edit the *Hiding* effect on that token's actor.

### Custom definitions

From the main menu you can also:

- **Add Definition**: add a category, sub-category, trigger phrase, trap or cache. Traps and caches can have several hint sets, and one is chosen at random each time. Traps also store defaults for the Trap Details dialog: attack type, save DC, attack bonus and Detection DC.
- **Edit Definitions**: change or delete them. Editing a built-in trap or cache saves a custom copy that overrides it; only custom entries can be deleted.

Custom definitions are saved in the world, so they survive restarts and module updates.

## Built-in content

- **71 traps** (9 of them attack-roll traps at +5 to hit, such as the Autoturret, Choppa Pendulum and Snake Pit) across Sci-Fi, Natural, Misc (shown under Generic) and a Grimdark family with the sub-categories Imperial, Space Elves, Cyborgs, Greenskins and Biohorrors.
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
| Players see hints they shouldn't (or can't see any) | Hints placed before Detection DCs were added (v1.0.8 and earlier) use the old random stealth values. Place the trap again, or edit the *Hiding* effect on each hint token. An active Perception check banked in Stealthy can also reveal hints above a character's passive Perception; the *Clear Banked Perception* macro resets it. |
| Attack trap never hits | Check the target's AC and the trap's attack bonus in the chat card. A natural 20 always hits. |
| Damage ignores resistances | The damage type isn't a D&D 5e type, so it was applied as untyped damage. Use `piercing`, `fire` and so on. |

## Credits

Created by **The Horse**. Issues and suggestions are welcome on [GitHub](https://github.com/ryanw341/trap-automator/issues).
