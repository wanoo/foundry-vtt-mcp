// markdown.ts
// Conversion HTML → Markdown volontairement simple (sans dépendance) pour
// l'export des journaux : titres, emphase, listes, liens, tableaux basiques.
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Liens Foundry @UUID[...]{Label} → **Label**
  md = md.replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "**$1**");

  // Blocs
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, txt) => `\n${"#".repeat(Number(lvl))} ${txt.trim()}\n`);
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");
  md = md.replace(/<\/(ul|ol)>/gi, "\n");
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, txt) => `\n> ${txt.trim().replace(/\n/g, "\n> ")}\n`);
  md = md.replace(/<(p|div)[^>]*>/gi, "\n");
  md = md.replace(/<\/(p|div)>/gi, "\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Tableaux : cellules séparées par « | », lignes à la ligne
  md = md.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => {
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1].trim());
    return cells.length ? `\n| ${cells.join(" | ")} |` : "";
  });
  md = md.replace(/<\/?(table|thead|tbody)[^>]*>/gi, "\n");

  // Inline
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, "![]($1)");

  // Reste de balises + entités courantes
  md = md.replace(/<[^>]+>/g, "");
  md = md
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normaliser les sauts de ligne
  return md.replace(/\n{3,}/g, "\n\n").trim();
}
