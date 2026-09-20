"""Build-time branding pass: one canonical logo from public/icon.svg everywhere.

Source pages mix an older blue bird icon, the homepage play-mark,
and a text-only studio badge. Preserve layouts; swap symbols during the build
so even no-JavaScript clients get the same brand.
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
LOGO_DIV = re.compile(r'(<div\b[^>]*\bclass=["\']logo["\'][^>]*>\s*)<svg\b[^>]*>.*?</svg>', re.I | re.S)
FAVICON = re.compile(r'<link\b[^>]*\brel=["\']icon["\'][^>]*>', re.I | re.S)
STUDIO_BRAND = re.compile(r'(<div\b[^>]*\bclass=["\']brand["\'][^>]*>)\s*<span>\s*S\s*</span>', re.I)

for page in ROOT.rglob('*.html'):
    content = page.read_text(encoding='utf-8')
    content = LOGO_ANCHOR.sub(lambda m: m.group(1) + ICON, content)
    content = LOGO_DIV.sub(lambda m: m.group(1) + ICON, content)
    content = STUDIO_BRAND.sub(lambda m: m.group(1) + ICON, content)
    content = content.replace(ICON + 'Snipo</div>', ICON + 'Snipoclip</div>')
    if FAVICON.search(content):
        content = FAVICON.sub('<link rel="icon" type="image/svg+xml" href="/icon.svg">', content)
    elif '</head>' in content:
        content = content.replace('</head>', '<link rel="icon" type="image/svg+xml" href="/icon.svg">\n</head>', 1)
    if '</head>' in content and '/brand.css' not in content:
        content = content.replace('</head>', '<link rel="stylesheet" href="/brand.css">\n</head>', 1)
    if page == ROOT / 'pricing.html':
        banner = '<div class="wrap snipo-promo-banner"><strong>Have a complimentary access code?</strong> <a href="/login">Sign in to redeem it in your dashboard →</a><p>No card required. Access lasts for the code’s stated duration and does not renew automatically.</p></div>\n'
        content = content.replace('<footer>', banner + '<footer>', 1)
    page.write_text(content, encoding='utf-8')

print('Brand standardized across landing, blog and app pages.')
