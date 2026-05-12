import { describe, it, expect } from "vitest";
import { escapeXml, svgDataUri, iconButton } from "../../src/util/svg";

describe("svg.escapeXml", () => {
  it("escapes all five XML entities", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("leaves plain text alone", () => {
    expect(escapeXml("hello world 123")).toBe("hello world 123");
  });
});

describe("svg.svgDataUri", () => {
  it("returns a data: URI with URL-encoded content", () => {
    const uri = svgDataUri("<svg/>");
    expect(uri).toBe("data:image/svg+xml,%3Csvg%2F%3E");
  });
});

describe("svg.iconButton", () => {
  it("composes a 144×144 SVG with the given color and icon path", () => {
    const uri = iconButton("#ff0000", `<circle cx="72" cy="72" r="32" fill="white"/>`);
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    const decoded = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    expect(decoded).toContain('width="144"');
    expect(decoded).toContain('height="144"');
    expect(decoded).toContain('fill="#ff0000"');
    expect(decoded).toContain(`<circle cx="72" cy="72" r="32" fill="white"/>`);
  });

  it("escapes the color string to avoid SVG injection", () => {
    const uri = iconButton(`"/><script>x</script><foo color="`, `<g/>`);
    const decoded = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    expect(decoded).not.toContain("<script>");
    expect(decoded).toContain("&quot;");
  });
});
