"""Build-time branding pass: one canonical logo from public/icon.svg everywhere.

Source pages currently mix an older blue bird icon, the home page play-mark,
and a text-only studio badge. This pass preserves page layout and replaces just
brand symbols, avoiding duplicated SVG definitions or a JavaScript flash.
"""
from pathlib import Path
import re

ROOT = Path('/app/public')
ICON = '<img class="snipo-brand-mark" src="/icon.svg" alt="" aria-hidden="true">'
LOGO_ANCHOR = re.compile(
    r'(<a\b[^>]*\bclass\s*=\s*["\'][^"\']*\blogo\b[^"\']*["\'][^>]*>\s*)'
    r'(?:<span\b[^>]*\bclass=["\']logo-mark["\'][^>]*>.*?</span>|<svg\b[^>]*>.*?</svg>|<img\b[^>]*>)',
    re.I | re.S,
)
FAVICON = re.compile(r'<link\b[^>]*\brel=["\']icon["\'][^>]*>', re.I | re.S)
STUDIO_BRAND = re.compile(r'(<div\b[^>]*\bclass=["\']brand["\'][^>]*>)\s*<span>\s*S\s*</span>', re.I)

for page in ROOT.rglob('*.html'):
    content = page.read_text(encoding='utf-8')
    content = LOGO_ANCHOR.sub(lambda m: m.group(1) + ICON, content)
    content = STUDIO_BRAND.sub(lambda m: m.group(1) + ICON, content)
    if FAVICON.search(content):
        # Replace old data-URI favicons with the SAME canonical mark. Retain the
        # apple-touch icon and unrelated rel values.
        content = FAVICON.sub('<link rel="icon" type="image/svg+xml" href="/icon.svg">', content)
    elif '</head>' in content:
        content = content.replace('</head>', '<link rel="icon" type="image/svg+xml" href="/icon.svg">\n</head>', 1)
    if '</head>' in content and '/brand.css' not in content:
        content = content.replace('</head>', '<link rel="stylesheet" href="/brand.css">\n</head>', 1)
    if page == ROOT / 'pricing.html':
        # Marketing users must sign in before redeeming a free access code.
        banner = '<div class="wrap snipo-promo-banner"><strong>Have a complimentary access code?</strong> <a href="/login">Sign in to redeem it in your dashboard →</a><p>No card required. Access lasts for the code’s stated duration and does not renew automatically.</p></div>\n'
        content = content.replace('<footer>', banner + '<footer>', 1)
    page.write_text(content, encoding='utf-8')

print('Brand standardized across landing, blog and app pages.')
