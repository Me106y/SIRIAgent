import DOMPurify from "dompurify";
import { marked } from "marked";

import { linkify } from "../lib/fileLinks";

marked.setOptions({ gfm: true, breaks: true });

// 对话里的图按气泡宽度缩放（样式里还有高度上限），点一下开原图。
// 用 DOM 包一层 <a> 而不是拼字符串：模型可能把图写在链接里，避免嵌套 <a>。
function wrapImages(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const src = image.getAttribute("src") || "";
    if (!src || image.closest("a")) continue;
    const link = doc.createElement("a");
    link.className = "md-image";
    link.setAttribute("href", src);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.setAttribute("title", "查看原图");
    image.replaceWith(link);
    link.append(image);
  }
  return doc.body.innerHTML;
}

export function Markdown({ text }: { text: string }) {
  // 模型常把表格紧贴在段落下一行；GFM 需要空行，补一个。
  const normalized = linkify(text).replace(
    /\n(\|.+\|)\n(\|[\s:|-]+\|)/g,
    "\n\n$1\n$2",
  );
  const raw = marked.parse(normalized) as string;
  const wrapped = raw
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>");
  const safe = DOMPurify.sanitize(wrapped);
  // 文件链接新开窗口，避免把当前对话顶掉。
  const linked = safe.replace(
    /<a href="(\/api\/files\?[^"]*)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"',
  );
  return (
    <div className="markdown" dangerouslySetInnerHTML={{ __html: wrapImages(linked) }} />
  );
}
