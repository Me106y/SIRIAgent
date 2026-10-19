import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text }: { text: string }) {
  const raw = marked.parse(text) as string;
  const wrapped = raw
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>");
  const html = DOMPurify.sanitize(wrapped);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
