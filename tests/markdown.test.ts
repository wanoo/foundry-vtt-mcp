import { htmlToMarkdown } from "../src/core/markdown.js";

describe("htmlToMarkdown", () => {
  test("titres, gras, italique, listes", () => {
    const md = htmlToMarkdown("<h2>Acte VI</h2><p>Un <strong>duel</strong> <em>tendu</em>.</p><ul><li>Riar</li><li>Toydaria</li></ul>");
    expect(md).toContain("## Acte VI");
    expect(md).toContain("**duel**");
    expect(md).toContain("*tendu*");
    expect(md).toContain("- Riar");
    expect(md).toContain("- Toydaria");
  });

  test("liens @UUID Foundry aplatis", () => {
    expect(htmlToMarkdown('<p>@UUID[Compendium.world.crits.abc]{Stress mécanique} · Facile</p>'))
      .toBe("**Stress mécanique** · Facile");
  });

  test("liens, images, code, hr", () => {
    const md = htmlToMarkdown('<a href="https://x.y">doc</a><hr><code>a+b</code><img src="img.png">');
    expect(md).toContain("[doc](https://x.y)");
    expect(md).toContain("---");
    expect(md).toContain("`a+b`");
    expect(md).toContain("![](img.png)");
  });

  test("tableaux basiques", () => {
    const md = htmlToMarkdown("<table><tr><th>d100</th><th>Effet</th></tr><tr><td>1-9</td><td>Stress</td></tr></table>");
    expect(md).toContain("| d100 | Effet |");
    expect(md).toContain("| 1-9 | Stress |");
  });

  test("entités et balises inconnues nettoyées", () => {
    expect(htmlToMarkdown("<span>a&nbsp;&amp;&nbsp;b</span>")).toBe("a & b");
    expect(htmlToMarkdown("<section><p>texte</p></section>")).toBe("texte");
  });
});
