# Concept panel results

Ten concepts were generated from five design angles and scored 1-10 by three judges (retention, market/uniqueness, feasibility).

| # | Concept | Angle | Retention | Market | Feasibility | Total |
|---|---|---|---|---|---|---|
| 9 | **SUNDIAL**: You can't move the snow sprite. You can move the sun. | novel-verb | 7 | 7.5 | 8 | 22.5 |
| 0 | **SHADY**: You are the sun. He is a snowman. Keep him in the shade. | one-thumb-arcade | 6 | 8.5 | 7 | 21.5 |
| 3 | **Tipping Point**: Every domino can topple one 1.5x bigger. Start at a grain of rice. Topple the universe. | satisfying-physics | 6.5 | 8 | 6.5 | 21 |
| 8 | **PASTIME**: Every 4 seconds, your past self comes back. Stay close enough to use it, and don't touch it. | novel-verb | 8 | 6 | 7 | 21 |
| 7 | **GULPSTORM**: Breathe the swarm in. Blow it all away. | micro-roguelite | 8.5 | 6.5 | 5.5 | 20.5 |
| 1 | **BLOOMLOOP**: Plant it now. Bounce on it next lap. | one-thumb-arcade | 7 | 6.5 | 6.5 | 20 |
| 6 | **LOOPJACK**: Lasso the dice. Name the hand. Break the house. | micro-roguelite | 7.5 | 6.5 | 5 | 19 |
| 2 | **Puffer Press**: Puff up. Squish the twins. Set off the jelly avalanche. | satisfying-physics | 7 | 6 | 5.5 | 18.5 |
| 4 | **CREASE**: Fold the paper. Mirror twins merge. Find the perfect crease. | daily-puzzle-social | 6 | 5 | 7 | 18 |
| 5 | **PLATEAU**: Topple towers. Flatten the skyline. | daily-puzzle-social | 5 | 4.5 | 5.5 | 15 |

## Why SHADY

SUNDIAL (#9) had the highest aggregate score (22.5) and was the feasibility judge's top pick. Its core is the cleanest version of the strongest new verb in the set: one horizontal drag turns the sun, and every shadow in the world moves together. The control is a 1D azimuth dial with inertia and detents. Difficulty comes from one built-in formula, L = h / tan(elevation), so noon acts as a recurring boss and dusk and night act as relief. The coverage maths is exact, which lets a validator prove that every stretch can be survived. All of this is cheap and attractive in Canvas 2D with no art assets. The market judge's top pick, SHADY (#0), is the same idea with a weaker control scheme but a better hook and brand. So I kept SUNDIAL's rules and took SHADY's shell: the name SHADY (the sun wears shades and gives shade; store title "SHADY: Don't Melt Nubs"), Nubs the carrot-nosed snowman, a sun mascot in sunglasses whose face reacts, snowflakes that melt ahead of Nubs so your hands stay busy, the PHEW slow-mo save, and the funny puddle death.

Grafts that make the design stronger without adding bulk:
- From PASTIME: a self-blaming causal death line ("Melted by You at 12:04 PM, between the Grumpy Oak and the Blue Cottage") and serverless challenge links.
- From Tipping Point: a day-clock ruler with a personal-best flag and a challenge flag, so the next goal is always on screen.
- From CREASE: a spoiler-free emoji share strip with one glyph per in-game hour.
- From BLOOMLOOP and PASTIME: flake notes quantized to the music, with the run's melody replayed on the results screen.
- From the feasibility judge: a safe-arc guide band that fades out as you improve, an instant catch on touch-down, an angular-speed cap, reduced motion, headless bots, debug URL params, and the multiply union shadow layer.

I chose this over GULPSTORM (the retention judge's top pick) because GULPSTORM's scope and on-screen clutter (600+ entities, 24 cards, 6 reactions) are the riskiest build for an AI agent on mid-range Android, and its genre is the most crowded on the charts.

Prior-art check: a web search found only jam games (Melting Point on itch, a keyboard and mouse puzzle; Snowman Joe, where you steer the snowman). Nothing on the charts is a real-time, one-thumb endless game where you steer by turning the sun.

I also ran a throwaway Monte Carlo of the shadow rules (6 to 8 seeds, 360 angle bins). It showed that SUNDIAL's original object density was far too sparse: even an ideal reactive bot died on Day 1, and about 25% of 0.1 s steps were impossible. Every number in this design comes from the re-tuned run instead:
- Denser and larger casters, and clouds that ride along with Nubs.
- An idle player dies between 6:31 and 7:46 AM.
- A reactive bot with 200 ms lag dies at a median of about Day 1, 11:30 AM. That matches the intended first-run experience.
- A reactive bot with no lag reaches Day 3 to Day 5 around 10-11 AM.
- Before rescues, the validator finds only 2.2% of steps infeasible, all on Days 3 to 5 near noon. Rescue trees fix those.
