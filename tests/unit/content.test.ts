import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  COSMETICS,
  DEFAULT_EQUIPPED,
  MISSIONS,
  cosmeticsForSlot,
  equippedLooks,
  getAchievement,
  getCosmetic,
} from '../../src/meta/content.ts';
import { missionLabel, missionProgressText, missionTarget, parseMissionId, missionSlotId } from '../../src/meta/missions.ts';

const HEX = /^#[0-9A-F]{6}$/i;

describe('cosmetics catalog', () => {
  it('has the 24 items in 4 slots', () => {
    expect(COSMETICS).toHaveLength(24);
    expect(cosmeticsForSlot('scarf').map((c) => c.name)).toEqual([
      'Red Scarf', 'Mint Scarf', 'Plaid Scarf', 'Rainbow Scarf', 'Midnight Scarf', 'Gold Scarf', 'Aurora Scarf',
    ]);
    expect(cosmeticsForSlot('hat').map((c) => c.name)).toEqual(['No Hat', 'Beanie', 'Top Hat', 'Party Cone', 'Gilded Top Hat', 'Sun Visor', 'Crown']);
    expect(cosmeticsForSlot('nose').map((c) => c.name)).toEqual(['Carrot', 'Parsnip', 'Candy Cane', 'Pinecone', 'Icicle']);
    expect(cosmeticsForSlot('shades').map((c) => c.name)).toEqual(['Classic Shades', 'Round Shades', 'Aviators', 'Star Shades', 'Heart Shades']);
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(24);
  });

  it('prices items per GDD §6', () => {
    const cost = (id: string): number | string => {
      const u = getCosmetic(id)?.unlock;
      return u?.kind === 'snow' ? u.cost : (u?.kind ?? '?');
    };
    expect(['scarf-mint', 'scarf-plaid', 'scarf-rainbow', 'hat-beanie', 'hat-tophat', 'hat-cone', 'nose-parsnip', 'nose-cane', 'nose-pinecone'].map(cost))
      .toEqual([60, 150, 400, 80, 200, 300, 100, 250, 350]);
    expect(['shades-round', 'shades-aviator', 'scarf-midnight', 'hat-gilded'].map(cost)).toEqual([120, 250, 700, 1500]);
    expect(['scarf-red', 'hat-none', 'nose-carrot', 'shades-classic'].map(cost)).toEqual(['default', 'default', 'default', 'default']);
    // The Snow-priced catalog: 1,890 from v1.0 plus 2,570 new.
    expect(COSMETICS.reduce((n, c) => n + (c.unlock.kind === 'snow' ? c.unlock.cost : 0), 0)).toBe(4460);
  });

  it('ties every achievement item to the achievement that grants it', () => {
    for (const c of COSMETICS) {
      if (c.unlock.kind !== 'achievement') continue;
      expect(getAchievement(c.unlock.achievement)?.reward).toBe(c.id);
    }
    expect(getAchievement('seventh-sun')?.reward).toBe('scarf-gold');
    expect(getAchievement('high-noon')?.reward).toBe('hat-visor');
    expect(getAchievement('solstice')?.reward).toBe('hat-crown');
    expect(['sundancer', 'rematch', 'sunny-week', 'ice-cold'].map((id) => getAchievement(id)?.reward)).toEqual([
      'shades-star', 'shades-heart', 'scarf-aurora', 'nose-icicle',
    ]);
    // A15: glare-proof and the other new feats grant no item.
    for (const id of ['close-shave', 'glare-proof', 'night-gardener', 'forecaster']) expect(getAchievement(id)?.reward, id).toBeUndefined();
  });

  it('gives the renderer a valid look for every item', () => {
    for (const c of COSMETICS) {
      expect(c.look.slot).toBe(c.slot);
      const colors = Object.values(c.look).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === 'string' && v.startsWith('#'));
      expect(colors.length, c.id).toBeGreaterThan(0);
      for (const color of colors) expect(color, c.id).toMatch(HEX);
    }
    const looks = equippedLooks(DEFAULT_EQUIPPED);
    expect(looks.scarf.main).toBe('#E8475A');
    expect(looks.nose.main).toBe('#FF8A2B');
    expect(looks.shades).toMatchObject({ slot: 'shades', shape: 'classic', frame: '#2B2140' });
    expect(equippedLooks({ ...DEFAULT_EQUIPPED, shades: 'shades-aviator' }).shades.shape).toBe('aviator');
    // Unknown or wrong-slot ids fall back to the defaults.
    expect(equippedLooks({ scarf: 'hat-crown', hat: 'nope', nose: 'nose-cane', shades: 'scarf-red' }).scarf.main).toBe('#E8475A');
    expect(equippedLooks({ scarf: 'hat-crown', hat: 'nope', nose: 'nose-cane', shades: 'scarf-red' }).shades.shape).toBe('classic');
  });
});

describe('missions and achievements', () => {
  it('has the 13-mission pool in the polish-wave order, swings-3 at play-daily\'s index', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual([
      'reach-9am', 'flakes-10', 'survive-noon', 'mult-3', 'cloud-ride', 'reach-day-2', 'ice-crystal',
      'two-phews', 'gate-arch', 'clean-balls', 'reach-day-3', 'hold-x5', 'swings-3',
    ]);
    expect(MISSIONS.map((m) => m.reward)).toEqual([10, 10, 20, 15, 20, 30, 20, 25, 30, 30, 50, 30, 15]);
    // swings-3 waits for a recent best of 12:30 PM (fix round 1: nothing taught SWINGs before then).
    expect(MISSIONS.map((m) => m.gate)).toEqual([0, 0, 0, 0, 0, 390, 0, 0, 720, 720, 1080, 390, 390]);
    expect(MISSIONS.map((m) => missionLabel(m, 1))).toEqual([
      'Reach 9:00 AM',
      'Collect 10 flakes in one run',
      'Survive a noon (reach 12:30 PM)',
      'Reach a ×3 multiplier',
      "Ride a cloud's shadow for 3 s straight",
      'Reach Day 2',
      'Collect an Ice Crystal',
      'Two PHEWs in one run',
      'Walk under a gate arch between 11 AM and 1 PM',
      'Pass 2 gazing balls in one run with no glare contact',
      'Reach Day 3',
      'Reach a ×4 multiplier',
      'Land 3 SWINGs in one run',
    ]);
  });

  it('labels every mission at tier II', () => {
    expect(MISSIONS.map((m) => missionLabel(m, 2))).toEqual([
      'Reach Day 2 · 9:00 AM',
      'Collect 20 flakes in one run',
      "Survive Day 2's noon (reach 12:30 PM)",
      'Reach a ×5 multiplier',
      "Ride a cloud's shadow for 6 s straight",
      'Reach Day 3',
      'Collect 2 Ice Crystals in one run',
      '4 PHEWs in one run',
      'Walk under a gate arch between 11 AM and 1 PM',
      'Pass 4 gazing balls in one run with no glare contact',
      'Reach Day 4',
      // ×4 at tier II clamps to the ×5 cap.
      'Reach a ×5 multiplier',
      'Land 6 SWINGs in one run',
    ]);
  });

  it('scales goals by tier', () => {
    const byId = (id: string) => MISSIONS.find((m) => m.id === id)!;
    expect(missionTarget(byId('flakes-10'), 3)).toBe(30);
    expect(missionTarget(byId('mult-3'), 2)).toBe(5);
    expect(missionTarget(byId('hold-x5'), 1)).toBe(4);
    expect(missionTarget(byId('hold-x5'), 2)).toBe(5);
    expect(missionTarget(byId('clean-balls'), 1)).toBe(2);
    expect(missionTarget(byId('clean-balls'), 2)).toBe(4);
    expect(missionTarget(byId('reach-day-3'), 2)).toBe(2160);
    expect(missionTarget(byId('gate-arch'), 4)).toBe(1);
    expect(missionLabel(byId('ice-crystal'), 2)).toBe('Collect 2 Ice Crystals in one run');
    expect(missionLabel(byId('two-phews'), 3)).toBe('6 PHEWs in one run');
    expect(missionProgressText(byId('cloud-ride'), 1, 2.47, false)).toBe('2.4/3 s');
    expect(missionProgressText(byId('hold-x5'), 1, 3, false)).toBe('×3/×4');
    expect(missionProgressText(byId('hold-x5'), 2, 1, false)).toBe('×1/×5');
    expect(missionProgressText(byId('mult-3'), 1, 2, false)).toBe('×2/×3');
    expect(missionProgressText(byId('reach-day-2'), 1, 500, false)).toBe('Day 1 · 2:20 PM');
    expect(missionProgressText(byId('reach-9am'), 1, 170, false)).toBe('8:50 AM');
    expect(missionProgressText(byId('reach-9am'), 1, 0, false)).toBe('–');
    expect(missionProgressText(byId('gate-arch'), 1, 1, true)).toBe('Done');
  });

  it('encodes the tier in slot ids', () => {
    expect(missionSlotId('flakes-10', 1)).toBe('flakes-10');
    expect(missionSlotId('flakes-10', 2)).toBe('flakes-10@2');
    expect(parseMissionId('flakes-10@2')?.tier).toBe(2);
    expect(parseMissionId('flakes-10@1')).toBeNull();
    expect(parseMissionId('flakes-10@x')).toBeNull();
    expect(parseMissionId('bogus')).toBeNull();
  });

  it('has 19 achievements with riddles (16 plus the three Journey ones)', () => {
    expect(ACHIEVEMENTS.map((a) => a.name)).toEqual([
      'First Light', 'Night Owl', 'High Noon', 'Solstice', 'Seventh Sun', 'Phew-nomenal', 'Cloud Rider', 'Daily Habit',
      'Sundancer', 'Rematch', 'Sunny Week', 'Close Shave', 'Glare-Proof', 'Ice Cold', 'Night Gardener', 'Forecaster',
      'First Steps', 'Halfway There', 'Starry Road',
    ]);
    for (const a of ACHIEVEMENTS) expect(a.hint.length).toBeGreaterThan(10);
  });

  it('gives the Journey achievements no item rewards', () => {
    for (const id of ['journey-10', 'journey-100', 'three-star-20']) expect(getAchievement(id)?.reward).toBeUndefined();
  });
});
