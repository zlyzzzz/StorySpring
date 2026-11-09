export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
// Public icon artwork: Lucide. Keep assets/LUCIDE-LICENSE.txt in distributions.
// Source SVG paths are preserved; presentation sizes and stroke widths are adapted.
const iconPaths = {
  "characters": "<path d=\"M18 21a8 8 0 0 0-16 0\"/>\n  <circle cx=\"10\" cy=\"8\" r=\"5\"/>\n  <path d=\"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3\"/>",
  "setting": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/>\n  <path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>",
  "plot": "<path d=\"M15 6a9 9 0 0 0-9 9V3\"/>\n  <circle cx=\"18\" cy=\"6\" r=\"3\"/>\n  <circle cx=\"6\" cy=\"18\" r=\"3\"/>",
  "theme": "<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\"/>",
  "style": "<path d=\"M13 21h8\"/>\n  <path d=\"m15 5 4 4\"/>\n  <path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/>",
  "saved": "<rect width=\"8\" height=\"18\" x=\"3\" y=\"3\" rx=\"1\"/>\n  <path d=\"M7 3v18\"/>\n  <path d=\"M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"10\"/>\n  <path d=\"M12 6v6l4 2\"/>"
};
export const icon = (id) =>
  `<svg class="public-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[id] || ""}</svg>`;
export const leaf = `<svg class="hero-art public-hero" viewBox="0 0 240 190" aria-hidden="true">
  <ellipse class="wash" cx="132" cy="80" rx="65" ry="55"/>
  <g transform="translate(29 -8) scale(7.5)"><path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/>
  <path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/>
  <path d="M5 21h14"/></g>
  <text x="49" y="187" stroke="none" fill="currentColor" font-size="18" font-family="Caveat">room for a new beginning</text>
</svg>`;
