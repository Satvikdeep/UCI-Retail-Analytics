"""Render the project Markdown sources as standalone pages for the offline reader."""
import argparse
from collections import defaultdict
from html import escape
from os.path import relpath
from pathlib import Path
import re
import unicodedata
from urllib.parse import unquote, urlsplit, urlunsplit

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "dashboard/library"
DOCUMENTS = {
    "README.md": ("index", "Project guide"),
    "docs/FINDINGS.md": ("findings", "Findings register"),
    "docs/TECHNICAL.md": ("technical", "Technical appendix"),
    "docs/SOURCE.md": ("source", "Source and licence"),
    "docs/VALIDATION.md": ("validation", "Validation"),
    "docs/DECISIONS.md": ("decisions", "Decision log"),
    "docs/INTERVIEW_AND_LEARNING.md": ("interview", "Interview and learning"),
    "docs/PROGRESS.md": ("progress", "Progress and continuation"),
    "data/raw/README.md": ("raw", "Raw workbook"),
}
EDGE = re.compile(r'\s*(\w+)(?:\["([^"]+)"\])?\s+-->\s+(\w+)(?:\["([^"]+)"\])?\s*')


def model_figure(source):
    """Render the directed edges of this project's model with semantic HTML."""
    lines = source.strip().splitlines()
    if not lines or lines[0] != "flowchart TD":
        return None
    nodes = {}
    edges = defaultdict(list)
    for line in lines[1:]:
        match = EDGE.fullmatch(line)
        if not match:
            return None
        origin, origin_label, target, target_label = match.groups()
        if origin_label:
            nodes[origin] = origin_label
        if target_label:
            nodes[target] = target_label
        edges[origin].append(target)
    if any(node not in nodes for origin, targets in edges.items() for node in [origin, *targets]):
        return None

    rows = []
    for origin, targets in edges.items():
        children = "".join(f"<li>{escape(nodes[target])}</li>" for target in targets)
        rows.append(f'<div><dt>{escape(nodes[origin])}</dt><dd><ul>{children}</ul></dd></div>')
    return (
        '<figure class="model-flow"><figcaption>Data model</figcaption>'
        '<div class="model-columns" aria-hidden="true"><span>Input</span><span>Downstream models</span></div>'
        f'<dl>{"".join(rows)}</dl></figure>\n'
    )


def fence(renderer, tokens, index, options, env):
    token = tokens[index]
    if token.info == "mermaid":
        return model_figure(token.content) or renderer.fence(tokens, index, options, env)
    return renderer.fence(tokens, index, options, env)


def local_link(source, url):
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return url
    path = (source.parent / unquote(parsed.path)).resolve()
    document = DOCUMENTS.get(path.relative_to(ROOT).as_posix())
    if document is not None:
        return urlunsplit(("", "", f"{document[0]}.html", parsed.query, parsed.fragment))
    relative = Path(relpath(path, LIBRARY)).as_posix()
    if parsed.path.endswith("/"):
        relative += "/"
    return urlunsplit(("", "", relative, parsed.query, parsed.fragment))


def rewrite_links(tokens, source):
    for token in tokens:
        if token.type == "link_open":
            token.attrSet("href", local_link(source, token.attrGet("href")))
        if token.children:
            rewrite_links(token.children, source)


def heading_id(text):
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-") or "section"


def render(source_path, filename, label):
    markdown = MarkdownIt("commonmark", {"html": False}).enable("table")
    markdown.add_render_rule("fence", fence)
    source = ROOT / source_path
    tokens = markdown.parse(source.read_text(encoding="utf-8"))
    if len(tokens) < 3 or tokens[0].tag != "h1":
        raise ValueError(f"Every document must begin with its title: {source_path}")
    title = tokens[1].content
    tokens = tokens[3:]
    sections = []
    used_ids = defaultdict(int)
    for index, token in enumerate(tokens):
        if token.type != "heading_open":
            continue
        heading = tokens[index + 1].content
        slug = heading_id(heading)
        used_ids[slug] += 1
        anchor = slug if used_ids[slug] == 1 else f"{slug}-{used_ids[slug]}"
        token.attrSet("id", anchor)
        if token.tag == "h2":
            sections.append((heading, anchor))
    rewrite_links(tokens, source)
    body = markdown.renderer.render(tokens, markdown.options, {})
    body = body.replace("<table>", '<div class="table-wrap" tabindex="0" role="region" aria-label="Document table"><table>')
    body = body.replace("</table>", "</table></div>")

    navigation = []
    for target, target_label in DOCUMENTS.values():
        current = ' aria-current="page"' if filename == target else ""
        navigation.append(f'<a href="{target}.html"{current}>{escape(target_label)}</a>')
    contents = ""
    if sections:
        items = "".join(f'<a href="#{anchor}">{escape(heading)}</a>' for heading, anchor in sections)
        contents = f'      <nav class="doc-toc" aria-label="On this page"><h2>On this page</h2><div>{items}</div></nav>\n'

    return f"""<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(label)} | Retail II</title>
  <link rel="stylesheet" href="../styles.css">
  <link rel="stylesheet" href="../library.css">
</head>
<body class="library">
  <a class="skip" href="#main">Skip to document</a>
  <header class="masthead">
    <div class="frame masthead-inner">
      <a href="../index.html" class="wordmark" aria-label="Retail II home">Retail<span>II</span></a>
      <nav class="utility-nav" aria-label="Project">
        <a href="../index.html">Dashboard</a>
        <a href="../report.html" aria-label="Executive report"><span class="full-label">Executive report</span><span class="short-label" aria-hidden="true">Report</span></a>
        <a href="index.html" aria-label="Documentation" aria-current="page"><span class="full-label">Documentation</span><span class="short-label" aria-hidden="true">Docs</span></a>
      </nav>
    </div>
  </header>
  <div class="frame library-layout">
    <aside class="library-index">
      <nav aria-label="Documents">
        <h2>Project documents</h2>
        <div>{"".join(navigation)}</div>
      </nav>
    </aside>
    <main id="main" tabindex="-1">
      <header class="doc-heading">
        <a href="../../{escape(source_path)}">View Markdown</a>
        <h1>{escape(title)}</h1>
      </header>
{contents}      <article class="doc-content">
{body}
      </article>
      <footer class="page-footer">
        <span>Retail II · UCI Online Retail II</span>
        <a href="source.html">Source and licence</a>
      </footer>
    </main>
  </div>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the static pages are out of date")
    args = parser.parse_args()
    if not args.check:
        LIBRARY.mkdir(exist_ok=True)
    stale = []
    for source, (filename, label) in DOCUMENTS.items():
        page = LIBRARY / f"{filename}.html"
        result = render(source, filename, label)
        if args.check:
            if not page.exists() or page.read_text(encoding="utf-8") != result:
                stale.append(page.relative_to(ROOT).as_posix())
        else:
            page.write_text(result, encoding="utf-8")
    if stale:
        raise SystemExit("Regenerate documentation: " + ", ".join(stale))
    print(f"{'Verified' if args.check else 'Rendered'} {len(DOCUMENTS)} documentation pages.")


if __name__ == "__main__":
    main()
