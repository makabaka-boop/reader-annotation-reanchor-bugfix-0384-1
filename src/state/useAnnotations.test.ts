// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAnnotations } from './useAnnotations';
import { sampleBookV1, sampleBookV2 } from '../samples';
import { buildExport } from '../export';
import type { Book } from '../types';

beforeEach(() => {
  localStorage.clear();
});

describe('useAnnotations 端到端', () => {
  it('新增批注 → 持久化 → 重载入同一版本仍定位', () => {
    const { result, rerender } = renderHook(() => useAnnotations());

    act(() => result.current.importBook(structuredClone(sampleBookV1)));
    const ch = result.current.flat!.chapters[0];
    const s = ch.text.indexOf('王木匠推开店门');
    act(() => result.current.addAnnotation(ch.id, s, s + '王木匠推开店门'.length, '第一条'));
    const id = result.current.annotations[0].id;
    expect(result.current.annotations[0].status).toBe('anchored');
    expect(JSON.parse(localStorage.getItem('reader:annotations:sample-book')!)[0].anchor.text).toContain('王木匠');

    // 模拟刷新：重新载入同一版本
    const { result: r2 } = renderHook(() => useAnnotations());
    act(() => r2.current.importBook(structuredClone(sampleBookV1)));
    expect(r2.current.annotations).toHaveLength(1);
    expect(r2.current.annotations[0].id).toBe(id);
    expect(r2.current.annotations[0].status).toBe('anchored');
    expect(r2.current.annotations[0].note).toBe('第一条');
    rerender();
  });

  it('导入新版本：唯一迁移 / 多处待裁决 / 找不到失联；裁决与删除分别作用于重叠批注', () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.importBook(structuredClone(sampleBookV1)));
    const ch = result.current.flat!.chapters[0];
    const add = (needle: string) => {
      const s = ch.text.indexOf(needle);
      act(() => result.current.addAnnotation(ch.id, s, s + needle.length, needle));
    };
    add('王木匠推开店门');
    add('他点了点头。');
    add('只剩一盏灯还亮着');

    // 导入 v2 触发重锚
    act(() => result.current.importBook(structuredClone(sampleBookV2)));
    const [a, b, c] = result.current.annotations;
    expect(a.status).toBe('anchored');
    expect(b.status).toBe('ambiguous');
    expect(b.candidates).toHaveLength(2);
    expect(c.status).toBe('lost');
    // 失联批注保留原文证据
    expect(c.anchor.text).toBe('只剩一盏灯还亮着');

    // 裁决选第二个候选
    act(() => result.current.resolve(b.id, b.candidates![1]));
    const resolved = result.current.annotations.find((x) => x.id === b.id)!;
    expect(resolved.status).toBe('anchored');
    expect(resolved.anchor.start).toBe(b.candidates![1].start);

    // 删除只影响被删的一条，其余保留（重叠批注可分别删除）
    act(() => result.current.deleteAnnotation(a.id));
    expect(result.current.annotations.map((x) => x.id)).toEqual([b.id, c.id]);
  });

  it('失联批注修改备注后仍持久化，且不会被系统猜测放置', () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.importBook(structuredClone(sampleBookV1)));
    const ch = result.current.flat!.chapters[0];
    const s = ch.text.indexOf('只剩一盏灯还亮着');
    act(() => result.current.addAnnotation(ch.id, s, s + 8, '证据'));
    act(() => result.current.importBook(structuredClone(sampleBookV2)));
    const lost = result.current.annotations[0];
    expect(lost.status).toBe('lost');
    act(() => result.current.updateNote(lost.id, '补充说明'));
    const stored = JSON.parse(localStorage.getItem('reader:annotations:sample-book')!);
    expect(stored[0].note).toBe('补充说明');
    expect(stored[0].status).toBe('lost');
  });
});

/**
 * 场景：保存批注 → 刷新页面（内存清空，仅 localStorage 保留）→ 直接导入同书新版本。
 * 版本比较必须落在持久化的书本上，否则新版会被误判为同版本重载，
 * 旧坐标快路径会绕过重锚（旧坐标文字仍在就高亮旧位置、重复句跳过待裁决）。
 */
describe('刷新后直接导入新版本', () => {
  // v1 → v2 的变化（同一本书，id 相同、version 不同）：
  //  - c1 末尾「继续」→「结束」：前文不动，旧坐标处文字不变但上下文已改
  //  - 「他笑了。」在 c1 出现两次，且第一处仍在旧坐标 [0,4)
  //  - c2 重新分段，连续文字不变（跨段选区应自动迁移）
  const refreshV1: Book = {
    id: 'refresh-book',
    title: '刷新测试',
    version: '1',
    chapters: [
      { id: 'c1', title: '第一章', paragraphs: [{ id: 'p1', text: '他笑了。故事开始。他笑了。故事继续。' }] },
      {
        id: 'c2',
        title: '第二章',
        paragraphs: [
          { id: 'q1', text: '第一段文字。' },
          { id: 'q2', text: '第二段文字。' },
        ],
      },
    ],
  };
  const refreshV2: Book = {
    id: 'refresh-book',
    title: '刷新测试',
    version: '2',
    chapters: [
      { id: 'c1', title: '第一章', paragraphs: [{ id: 'p1', text: '他笑了。故事开始。他笑了。故事结束。' }] },
      {
        id: 'c2',
        title: '第二章',
        paragraphs: [
          { id: 'q1', text: '第一段文' },
          { id: 'q2', text: '字。第二段文字。' },
        ],
      },
    ],
  };

  /** 在 v1 中建四条批注并持久化：重复句 / 唯一句 / 将失联 / 跨段。 */
  function seedAnnotations() {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.importBook(structuredClone(refreshV1)));
    const c1 = result.current.flat!.chapterById.get('c1')!;
    const c2 = result.current.flat!.chapterById.get('c2')!;
    const add = (ch: typeof c1, start: number, end: number, note: string) =>
      act(() => result.current.addAnnotation(ch.id, start, end, note));
    add(c1, 0, 4, '重复句'); // 「他笑了。」第一处
    add(c1, 4, 9, '唯一句'); // 「故事开始。」
    add(c1, 13, 18, '将失联'); // 「故事继续。」
    add(c2, 4, 11, '跨段'); // 「字。\n第二段文」
    expect(result.current.annotations.map((a) => a.status)).toEqual([
      'anchored',
      'anchored',
      'anchored',
      'anchored',
    ]);
    return result.current.annotations.map((a) => a.id);
  }

  it('旧坐标命中也要按证据重锚：上下文刷新、重复句待裁决、失联保留证据、跨段迁移', () => {
    const [dupId, uniqId, lostId, crossId] = seedAnnotations();

    // 模拟刷新：全新 hook（内存为空），直接导入 v2
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.importBook(structuredClone(refreshV2)));

    const byId = (id: string) => result.current.annotations.find((a) => a.id === id)!;

    // 重复句：新版中出现两次 → 待裁决，候选两处，绝不沿用旧坐标
    const dup = byId(dupId);
    expect(dup.status).toBe('ambiguous');
    expect(dup.candidates).toHaveLength(2);
    expect(dup.candidates!.map((c) => c.start)).toEqual([0, 9]);

    // 唯一句：仍在原坐标 → 自动迁移，但上下文证据必须来自 v2（「结束」而非「继续」）
    const uniq = byId(uniqId);
    expect(uniq.status).toBe('anchored');
    expect(uniq.anchor.start).toBe(4);
    expect(uniq.anchor.suffix).toBe('他笑了。故事结束。');
    expect(uniq.anchor.suffix).not.toContain('继续');

    // 失联：保留 v1 原文证据，不放置任何高亮
    const lost = byId(lostId);
    expect(lost.status).toBe('lost');
    expect(lost.anchor.text).toBe('故事继续。');

    // 跨段选区：v2 重新分段后凭连续文字唯一命中
    const cross = byId(crossId);
    expect(cross.status).toBe('anchored');
    expect(cross.anchor.text.replace(/\n/g, '')).toBe('字。第二段文');

    // 持久化与内存同源：localStorage 中的状态与画面一致
    const stored = JSON.parse(localStorage.getItem('reader:annotations:refresh-book')!) as Array<{
      id: string;
      status: string;
    }>;
    expect(Object.fromEntries(stored.map((s) => [s.id, s.status]))).toEqual({
      [dupId]: 'ambiguous',
      [uniqId]: 'anchored',
      [lostId]: 'lost',
      [crossId]: 'anchored',
    });

    // 导出与画面同源：计数一致，已定位批注的上下文证据指向 v2
    const payload = buildExport(result.current.book!, result.current.annotations);
    expect(payload.version).toBe('2');
    expect(payload.counts).toEqual({ anchored: 2, ambiguous: 1, lost: 1 });
    const exportedUniq = payload.annotations.find((a) => a.id === uniqId)!;
    expect(exportedUniq.suffix).toBe('他笑了。故事结束。');
  });

  it('裁决后再次刷新重载：状态稳定，全部指向同一版本', () => {
    const [dupId] = seedAnnotations();
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.importBook(structuredClone(refreshV2)));
    const dup = result.current.annotations.find((a) => a.id === dupId)!;
    // 采纳第二处候选
    act(() => result.current.resolve(dupId, dup.candidates![1]));
    expect(result.current.annotations.find((a) => a.id === dupId)!.status).toBe('anchored');
    expect(result.current.annotations.find((a) => a.id === dupId)!.anchor.start).toBe(9);

    // 再次刷新 + 重载同一版本：裁决结果保留，其余状态不漂移
    const { result: r2 } = renderHook(() => useAnnotations());
    act(() => r2.current.importBook(structuredClone(refreshV2)));
    const again = r2.current.annotations.find((a) => a.id === dupId)!;
    expect(again.status).toBe('anchored');
    expect(again.anchor.start).toBe(9);
    expect(r2.current.annotations.map((a) => a.status).sort()).toEqual(['anchored', 'anchored', 'anchored', 'lost']);
  });
});
