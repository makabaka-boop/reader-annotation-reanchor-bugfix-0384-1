import type { Annotation, Book } from '../types';
import { flattenBook, type FlatBook } from './flatten';
import { reanchorOne } from './anchor';

const compactString = (s: string): string => s.replace(/\n/g, '');

/** 章节身份 + 规范化正文的签名：判断「内容是否变化」的客观依据。 */
function contentSignature(book: FlatBook): string {
  return book.chapters.map((c) => `${c.id}\u0000${c.text}`).join('\u0001');
}

/**
 * next 相对 prev 是否为「新版本」（即：旧坐标是否还可信）：
 *
 * - 双方都有版本号且不同 → 新版（即使正文逐字相同，坐标也不再权威）；
 * - 其余情况以正文签名为准：内容变了就是新版
 *   （版本号缺失、或改了内容却没 bump 版本号，都不能信旧坐标）。
 *
 * 只有返回 false 时才允许走 ensureAnchored 的坐标快路径。
 */
export function isNewVersion(prev: Book, next: Book, nextFlat: FlatBook): boolean {
  if (prev.version !== undefined && next.version !== undefined && prev.version !== next.version) return true;
  return contentSignature(flattenBook(prev)) !== contentSignature(nextFlat);
}

/** 检查现存锚点坐标处的文字是否仍与证据一致（同一书稿重载时坐标权威）。 */
export function anchorStillValid(annotation: Annotation, book: FlatBook): boolean {
  if (annotation.status !== 'anchored') return false;
  const ch = book.chapterById.get(annotation.anchor.chapterId);
  if (!ch) return false;
  const { start, end, text } = annotation.anchor;
  if (start < 0 || end > ch.text.length || end <= start) return false;
  return compactString(ch.text.slice(start, end)) === compactString(text);
}

/**
 * 载入同一书稿（同一版本）时：坐标与文字吻合的锚点直接保留，
 * 其余按证据重锚。
 */
export function ensureAnchored(annotations: Annotation[], book: FlatBook): Annotation[] {
  return annotations.map((a) => (anchorStillValid(a, book) ? a : reanchorOne(a, book)));
}

/** 导出用：章节标题解析。 */
export function chapterTitle(book: FlatBook, chapterId: string): string {
  return book.chapterById.get(chapterId)?.title ?? chapterId;
}
