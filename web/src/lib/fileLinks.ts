const FILE_EXT = "html|pdf|png|jpe?g|json|csv|md|txt|zip";
const FILE_PATH_RE = new RegExp(
  `(?:/home/[^\\s<>"'\`]+\\.(?:${FILE_EXT})|reports/[^\\s<>"'\`]+\\.(?:${FILE_EXT}))`,
  "g",
);
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const MD_LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const PLACEHOLDER_RE = /\u0000(\d+)\u0000/g;

function isLocalTarget(target: string): boolean {
  return (
    target.startsWith("reports/") ||
    target.startsWith("workspace/") ||
    target.startsWith("/home/") ||
    target.startsWith("file://")
  );
}

export function fileUrl(path: string): string {
  return `/api/files?path=${encodeURIComponent(path.replace(/^file:\/\//, ""))}`;
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function linkifySegment(segment: string): string {
  // 已写成 markdown 链接的本地文件：先把目标改写成 /api/files（否则浏览器会请求 /home/… 而 404），
  // 再整体保护起来，避免下面的裸路径替换把链接文本/目标二次套娃。
  const rewritten = segment.replace(
    MD_LINK_RE,
    (match, bang: string, label: string, target: string) => {
      if (!isLocalTarget(target)) return match;
      return `${bang}[${label}](${fileUrl(target)})`;
    },
  );
  const stash: string[] = [];
  const protectedText = rewritten.replace(MD_LINK_RE, (match) => {
    stash.push(match);
    return `\u0000${stash.length - 1}\u0000`;
  });

  const withInline = protectedText.replace(
    INLINE_CODE_RE,
    (match, inner: string) => {
      if (!new RegExp(`\\.(?:${FILE_EXT})$`).test(inner)) return match;
      return `[${fileName(inner)}](${fileUrl(inner)})`;
    },
  );
  const linked = withInline.replace(
    FILE_PATH_RE,
    (path) => `[${fileName(path)}](${fileUrl(path)})`,
  );
  return linked.replace(PLACEHOLDER_RE, (_, index: string) => stash[Number(index)]);
}

/** 把模型输出里的本地文件路径变成可点击的 /api/files 链接；代码块不处理。 */
export function linkify(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) => (index % 2 === 1 ? part : linkifySegment(part)))
    .join("");
}
