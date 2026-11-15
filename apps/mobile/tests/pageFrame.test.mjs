import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { acrossPage } from '../src/pageFrame.ts';

// A view laid over the page from one side to the other (the voice panel) starts at the page's left edge
// and ends at its right, wherever on the page the view it hangs from is.
describe('acrossPage', () => {
  for (const [name, page, fromX] of [
    ['a page that is the whole window', { x: 0, width: 402 }, 16],
    ['the page beside the session list', { x: 320, width: 349 }, 336],
    ['the page beside the list, the screen on its side behind a camera', { x: 379, width: 512 }, 395],
    ['a phone on its side, the page clear of the camera', { x: 59, width: 756 }, 75],
  ]) {
    test(`spans ${name}`, () => {
      const { left, width } = acrossPage(page, fromX);
      assert.equal(fromX + left, page.x, 'left edge');
      assert.equal(fromX + left + width, page.x + page.width, 'right edge');
    });
  }
});
