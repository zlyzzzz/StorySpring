export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const iconPaths = {
  characters:
    '<circle cx="15" cy="12" r="6"/><path d="M4 36v-7c0-8 22-8 22 0v7M30 8c9-1 9 12 1 12M32 24c7 0 9 4 9 10"/>',
  setting:
    '<path d="M4 36h36M8 36V14l15-9 14 9v22M17 36V24h11v12M13 17h4M28 17h4"/>',
  plot: '<path d="M5 36c0-23 33 5 33-18 0-8-8-10-14-9M24 4v11l9-5"/><circle cx="5" cy="36" r="3"/>',
  theme:
    '<path d="M22 37S3 26 3 14C3 3 18 3 22 12 26 3 41 3 41 14 41 26 22 37 22 37Z"/>',
  style: '<path d="M6 35 30 5l8 7-25 28-9 2ZM26 10l8 7M6 35l7 5M19 39h20"/>',
};
export const icon = (id) =>
  `<svg viewBox="0 0 44 44" aria-hidden="true">${iconPaths[id]}</svg>`;
export const leaf =
  '<svg class="hero-art" viewBox="0 0 240 190" aria-hidden="true"><ellipse class="wash" cx="134" cy="85" rx="62" ry="51"/><path d="M27 155c37-16 63-40 94-86M86 113c-36 5-48-14-50-31 29-8 50 1 50 31ZM111 82c-1-35 24-53 54-50-3 34-24 48-54 50ZM37 154c42-1 88 6 161-6M120 135c15-17 38-14 48 2M158 148l16-28M173 121c3-17 16-23 30-17-8 17-17 21-30 17"/><path d="M27 156c42 23 101 25 171-7"/><text x="63" y="184" stroke="none" fill="currentColor" font-size="19" font-family="Caveat">room for a new beginning</text></svg>';
