import { describe, expect, it } from 'vitest';
import type { Book } from '../types';
import { flattenBook } from './flatten';
import { isNewVersion } from './validate';

function book(version: string | undefined, text: string): Book {
  const b: Book = {
    id: 'b',
    title: 't',
    chapters: [{ id: 'c1', title: '第一章', paragraphs: [{ id: 'p1', text }] }],
  };
  if (version !== undefined) b.version = version;
  return b;
}

describe('isNewVersion：旧坐标是否还可信', () => {
  it('版本号不同 → 新版（即使正文逐字相同，坐标也不再权威）', () => {
    const next = book('2', '同样的文字。');
    expect(isNewVersion(book('1', '同样的文字。'), next, flattenBook(next))).toBe(true);
  });

  it('版本号相同 + 正文相同 → 同版本（允许坐标快路径）', () => {
    const next = book('1', '同样的文字。');
    expect(isNewVersion(book('1', '同样的文字。'), next, flattenBook(next))).toBe(false);
  });

  it('版本号相同但正文已改 → 新版（没 bump 版本号也不能信旧坐标）', () => {
    const next = book('1', '改动后的文字。');
    expect(isNewVersion(book('1', '改动前的文字。'), next, flattenBook(next))).toBe(true);
  });

  it('版本号缺失：以正文签名为准', () => {
    const same = book(undefined, '同样的文字。');
    expect(isNewVersion(book(undefined, '同样的文字。'), same, flattenBook(same))).toBe(false);
    const diff = book(undefined, '改动后的文字。');
    expect(isNewVersion(book(undefined, '改动前的文字。'), diff, flattenBook(diff))).toBe(true);
  });

  it('只有一侧有版本号：同样以正文签名为准', () => {
    const same = book('2', '同样的文字。');
    expect(isNewVersion(book(undefined, '同样的文字。'), same, flattenBook(same))).toBe(false);
    const diff = book('2', '改动后的文字。');
    expect(isNewVersion(book(undefined, '改动前的文字。'), diff, flattenBook(diff))).toBe(true);
  });

  it('章节结构变化（增删章节/改章节 id）→ 新版', () => {
    const prev = book('1', '同样的文字。');
    const next: Book = {
      id: 'b',
      title: 't',
      version: '1',
      chapters: [
        { id: 'c1', title: '第一章', paragraphs: [{ id: 'p1', text: '同样的文字。' }] },
        { id: 'c2', title: '第二章', paragraphs: [{ id: 'p1', text: '新增章节。' }] },
      ],
    };
    expect(isNewVersion(prev, next, flattenBook(next))).toBe(true);
  });
});
