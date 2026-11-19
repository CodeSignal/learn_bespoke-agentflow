import { describe, expect, it } from 'vitest';

import { escapeHtml, renderMarkdown, sanitizeLinkUrl } from './markdown';

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;'
    );
  });
});

describe('sanitizeLinkUrl', () => {
  it('allows http, https and mailto', () => {
    expect(sanitizeLinkUrl('https://example.com/a?b=1&c=2')).toBe('https://example.com/a?b=1&c=2');
    expect(sanitizeLinkUrl('HTTP://example.com')).toBe('HTTP://example.com');
    expect(sanitizeLinkUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('rejects script, data and unknown schemes, and relative URLs', () => {
    expect(sanitizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeLinkUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(sanitizeLinkUrl('data:text/html,<script>1</script>')).toBeNull();
    expect(sanitizeLinkUrl('vbscript:x')).toBeNull();
    expect(sanitizeLinkUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeLinkUrl('/relative/path')).toBeNull();
    expect(sanitizeLinkUrl('//evil.example')).toBeNull();
  });

  it('strips control characters before checking the scheme', () => {
    const controlChar = String.fromCharCode(1);
    const tab = String.fromCharCode(9);
    expect(sanitizeLinkUrl(`${controlChar}javascript:alert(1)`)).toBeNull();
    expect(sanitizeLinkUrl(`java${tab}script:alert(1)`)).toBeNull();
    expect(sanitizeLinkUrl(`${controlChar}https://example.com`)).toBe('https://example.com');
  });
});

describe('renderMarkdown', () => {
  it('escapes raw HTML in text', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders safe links with target and rel', () => {
    expect(renderMarkdown('[site](https://example.com)')).toBe(
      '<div><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></div>'
    );
  });

  it('renders links with unsafe URLs as plain text', () => {
    const controlChar = String.fromCharCode(1);
    for (const url of ['javascript:alert(1)', 'data:text/html;base64,AAAA', `${controlChar}javascript:alert(1)`]) {
      const html = renderMarkdown(`[click](${url})`);
      expect(html).not.toContain('<a');
      expect(html).not.toContain('href');
      expect(html).toContain('click');
    }
  });

  it('cannot break out of the href attribute', () => {
    const html = renderMarkdown('[x](https://example.com/"onmouseover="alert(1))');
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain('&quot;onmouseover=&quot;');
  });

  it('keeps underscores in link URLs intact', () => {
    const html = renderMarkdown('[docs](https://example.com/foo_bar_baz) and _after_');
    expect(html).toContain('href="https://example.com/foo_bar_baz"');
    expect(html).toContain('<em>after</em>');
  });

  it('keeps one level of parentheses in link URLs', () => {
    const html = renderMarkdown('[Rust](https://en.wikipedia.org/wiki/Rust_(programming_language))');
    expect(html).toContain('href="https://en.wikipedia.org/wiki/Rust_(programming_language)"');
  });

  it('does not italicise underscores inside words', () => {
    expect(renderMarkdown('use my_var_name and other_name here')).toBe(
      '<div>use my_var_name and other_name here</div>'
    );
  });

  it('renders emphasis at word boundaries', () => {
    expect(renderMarkdown('**bold** *it* _it2_ __b2__')).toBe(
      '<div><strong>bold</strong> <em>it</em> <em>it2</em> <strong>b2</strong></div>'
    );
  });

  it('does not treat spaced asterisks as emphasis', () => {
    expect(renderMarkdown('2 * 3 * 4')).toBe('<div>2 * 3 * 4</div>');
  });

  it('leaves inline code untouched by emphasis rules', () => {
    expect(renderMarkdown('run `a_b_c * d * e **f**` now')).toBe(
      '<div>run <code>a_b_c * d * e **f**</code> now</div>'
    );
  });

  it('escapes HTML inside inline code and code blocks', () => {
    expect(renderMarkdown('`<b>`')).toBe('<div><code>&lt;b&gt;</code></div>');
    expect(renderMarkdown('```html\n<b>_x_</b>\n```')).toBe('<pre><code>&lt;b&gt;_x_&lt;/b&gt;</code></pre>');
  });

  it('keeps footnote-like lines inside code blocks', () => {
    const html = renderMarkdown('```\n[^1]: not a footnote\n```');
    expect(html).toBe('<pre><code>[^1]: not a footnote</code></pre>');
  });

  it('renders footnotes outside code blocks', () => {
    const html = renderMarkdown('Claim[^a]\n\n[^a]: The source');
    expect(html).toContain('<sup class="md-fn-ref" id="fnref-a">1</sup>');
    expect(html).toContain('<li id="fn-a">1. The source</li>');
  });

  it('cannot forge placeholders with private-use characters', () => {
    const open = String.fromCharCode(0xe001);
    const close = String.fromCharCode(0xe002);
    const code = String.fromCharCode(0xe000);
    expect(renderMarkdown(`a ${open}0${close} b \`x\``)).toBe('<div>a 0 b <code>x</code></div>');
    expect(renderMarkdown(`${code}CODE0${code}`)).toBe('<div>CODE0</div>');
  });

  it('renders lists, headings and tables', () => {
    expect(renderMarkdown('# Title\n\n- one\n- two')).toBe('<h1>Title</h1><ul><li>one</li><li>two</li></ul>');
    expect(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')).toBe(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    );
  });
});
