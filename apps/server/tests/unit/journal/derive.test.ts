import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../../src/agents/claude/transcript/chat.js';
import { backgroundRunning, liveShown, taskList } from '../../../src/journal/derive.js';

describe('taskList', () => {
  it('works out the task list: TodoWrite all of it at once, tasks made, changed and deleted one at a time', () => {
    const items: ChatItem[] = [
      { k: 'todos', items: [{ subject: 'Old', status: 'pending' }] },
      { k: 'task', id: '1', subject: 'Write tests', status: 'pending' },
      { k: 'task', id: '2', subject: 'Ship', status: 'pending' },
      { k: 'task', id: '1', status: 'in_progress' },
      { k: 'task', id: '3', status: 'completed' },
      { k: 'task', id: '2', status: 'deleted' },
      { k: 'task', id: '4', subject: 'Docs' },
      { k: 'task', id: '1', subject: 'Write the tests' },
    ];
    expect(taskList(items)).toEqual([
      { subject: 'Old', status: 'pending' },
      { subject: 'Write the tests', status: 'in_progress' },
      { subject: 'Docs', status: 'pending' },
    ]);
    expect(taskList([...items, { k: 'todos', items: [{ subject: 'New', status: 'pending' }] }])).toEqual([{ subject: 'New', status: 'pending' }]);
  });
});

describe('backgroundRunning', () => {
  it('lists the commands still running in the background, named by the call that started each', () => {
    const items: ChatItem[] = [
      { k: 'tool', id: 't1', name: 'Bash', summary: 'npm run dev' },
      { k: 'bg', id: 'b1', tool: 't1', status: 'running' },
      { k: 'bg', id: 'b2', status: 'running' },
      { k: 'bg', id: 'b3', tool: 'gone', status: 'running' },
      { k: 'bg', id: 'b4', tool: 't1', status: 'running' },
      { k: 'bg', id: 'b4', status: 'completed' },
    ];
    expect(backgroundRunning(items)).toEqual([
      { id: 'b1', label: 'npm run dev' },
      { id: 'b2', label: 'b2' },
      { id: 'b3', label: 'b3' },
    ]);
  });
});

describe('liveShown', () => {
  it.each<[string, string | null, ChatItem[], string | null]>([
    ['nothing written', null, [], null],
    ['nothing in the transcript yet', 'The answer is', [], 'The answer is'],
    ['in the transcript, drawn and written differently', 'The answer is 42', [{ k: 'text', text: '* The **answer**\n  is `42`.' }], null],
    ['in the transcript before the last prompt only', 'The answer is', [{ k: 'text', text: 'The answer is 42.' }, { k: 'user', text: 'again' }], 'The answer is'],
  ])('shows the reply being written unless it is in the turn so far: %s', (_, live, items, shown) => {
    expect(liveShown(live, items)).toBe(shown);
  });
});
