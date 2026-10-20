import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

const FILE_EXT = "html|pdf|png|jpe?g|json|csv|md|txt|zip";
const FILE_PATH_RE = new RegExp(
  `(?:/home/[^\\s<>"'\`]+\\.(?:${FILE_EXT})|reports/[^\\s<>"'\`]+\\.(?:${FILE_EXT}))`,
  "g",
);
const INLINE_CODE_RE = /`([^`\n]+)`/g;

function fileUrl(path: string): string {
  const absolute = path.startsWith("reports/")
    ? `/home/siri/桌面/SIRIAgent/${path}`
    : path;
  return `/api/files?path=${encodeURIComponent(absolute)}`;
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function linkifySegment(segment: string): string {
  const withInline = segment.replace(INLINE_CODE_RE, (match, inner: string) => {
    if (!new RegExp(`\\.(?:${FILE_EXT})$`).test(inner)) return match;
    return `[${fileName(inner)}](${fileUrl(inner)})`;
  });
  return withInline.replace(
    FILE_PATH_RE,
    (path) => `[${fileName(path)}](${fileUrl(path)})`,
  );
}

/** 把模型输出里的本地文件路径变成可点击的 /api/files 链接；代码块不处理。 */
function linkify(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) => (index % 2 === 1 ? part : linkifySegment(part)))
    .join("");
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
  const html = safe.replace(
    /<a href="(\/api\/files\?[^"]*)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"',
  );
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
