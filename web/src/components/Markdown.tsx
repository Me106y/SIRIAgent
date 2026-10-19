import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text }: { text: string }) {
  // 模型常把表格紧贴在段落下一行；GFM 需要空行，补一个。
  const normalized = text.replace(/\n(\|.+\|)\n(\|[\s:|-]+\|)/g, "\n\n$1\n$2");
  const raw = marked.parse(normalized) as string;
  const wrapped = raw
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>");
  const html = DOMPurify.sanitize(wrapped);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
