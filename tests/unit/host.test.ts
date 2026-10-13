// The postcard saves through the artifact viewer's `downloads` capability when the page runs inside
// it (no <a download> there), and maps the player's answer to a share outcome.
import { afterEach, describe, expect, it } from 'vitest';
import { hostFileSaver, prepareHostDownloads } from '../../src/platform/host.ts';
import { shareFiles } from '../../src/platform/share.ts';

type Host = { use(name: string): Promise<unknown> };
const g = globalThis as { claude?: Host };

function install(save: (r: { filename: string; data: Blob }) => Promise<unknown>): string[] {
  const asked: string[] = [];
  g.claude = {
    use: async (name: string) => {
      asked.push(name);
      return name === 'downloads' ? { save } : null;
    },
  };
  return asked;
}

const card = (): File => new File([new Uint8Array([137, 80, 78, 71])], 'shady-day2-240pm.png', { type: 'image/png' });
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete g.claude;
});

describe('host downloads', () => {
  it('stays off outside a host', async () => {
    // Runs first in this file: no host has installed a saver yet.
    prepareHostDownloads();
    await settle();
    expect(hostFileSaver()).toBeNull();
  });

  it('saves the postcard through the viewer and reports it as saved', async () => {
    const saved: { filename: string; size: number }[] = [];
    const asked = install(async (r) => {
      saved.push({ filename: r.filename, size: r.data.size });
      return { status: 'saved' };
    });
    prepareHostDownloads();
    await settle();
    expect(asked).toEqual(['downloads']);
    expect(hostFileSaver()).not.toBeNull();
    expect(await shareFiles({ file: card(), text: 'SHADY: Nubs made it to Day 2 · 2:40 PM' })).toBe('saved');
    expect(saved).toEqual([{ filename: 'shady-day2-240pm.png', size: 4 }]);
  });

  it('treats a declined prompt as cancelled and other refusals as failed', async () => {
    install(async () => Promise.reject({ code: 'declined', message: 'no' }));
    prepareHostDownloads();
    await settle();
    expect(await shareFiles({ file: card(), text: 't' })).toBe('cancelled');
    install(async () => Promise.reject({ code: 'rejected_extension', message: 'nope' }));
    prepareHostDownloads();
    await settle();
    expect(await shareFiles({ file: card(), text: 't' })).toBe('failed');
  });
});
