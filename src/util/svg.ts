export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Render a 144×144 button icon with a colored background and an SVG icon path. */
export function iconButton(color: string, iconPath: string): string {
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">` +
    `<rect width="144" height="144" rx="16" fill="${escapeXml(color)}"/>` +
    `${iconPath}</svg>`,
  );
}
