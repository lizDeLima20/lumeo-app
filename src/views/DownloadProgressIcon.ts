/** Outlined download control drawn over an Explore cover.
 *
 *  The ring and the arrow fill only ever show real progress: `progress(percent)` is called
 *  with the share of bytes actually received, and `null` (the Drive did not send a size)
 *  switches to an activity spinner that never pretends to know how far the download is. */
export type DownloadIconState = "idle" | "open" | "downloading" | "indeterminate" | "saving" | "done" | "error";

const SVG = "http://www.w3.org/2000/svg";
let sequence = 0;

export class DownloadProgressIcon {
  private readonly ring: SVGCircleElement;
  private readonly fill: SVGRectElement;

  public constructor(private readonly button: HTMLButtonElement, opened: boolean) {
    const id = `lumeo-dl-${++sequence}`;
    const svg = node("svg", { class: "download-icon", viewBox: "0 0 32 32", "aria-hidden": "true", focusable: "false" });
    const defs = node("defs", {});
    const gradient = node("linearGradient", { id: `${id}-g`, x1: "0", y1: "0", x2: "0", y2: "1" });
    gradient.append(node("stop", { offset: "0", "stop-color": "#8b5cf6", "stop-opacity": ".82" }), node("stop", { offset: "1", "stop-color": "#9ca3af", "stop-opacity": ".72" }));
    const clip = node("clipPath", { id: `${id}-c` });
    this.fill = node("rect", { x: "0", y: "0", width: "32", height: "0" }) as SVGRectElement;
    clip.append(this.fill); defs.append(gradient, clip);
    const track = node("circle", { class: "download-icon__track", cx: "16", cy: "16", r: "14" });
    this.ring = node("circle", { class: "download-icon__ring", cx: "16", cy: "16", r: "14", pathLength: "100" }) as SVGCircleElement;
    // Arrow body as one closed shape: the translucent fill and the crisp outline share it.
    const arrow = opened ? "M12 11h9v9M21 11 11 21" : "M14 8h4v8.5h3.6L16 23l-5.6-6.5H14Z";
    const body = node("path", { class: "download-icon__fill", d: arrow, fill: `url(#${id}-g)`, "clip-path": `url(#${id}-c)` });
    const outline = node("path", { class: "download-icon__arrow", d: arrow });
    svg.append(defs, track, this.ring, body, outline); button.replaceChildren(svg);
    this.set(opened ? "open" : "idle", 0);
  }

  public set(state: DownloadIconState, percent: number | null = null): void {
    this.button.dataset.state = state;
    if (percent == null) return;
    const value = Math.max(0, Math.min(100, percent));
    this.ring.style.strokeDashoffset = String(100 - value);
    // Top to bottom: the arrow fills from its tip side downwards with the bytes received.
    this.fill.setAttribute("height", String(32 * value / 100));
  }

  /** Real byte share, or `null` when the total size is unknown. */
  public progress(percent: number | null): void {
    if (percent == null) { this.set("indeterminate"); return; }
    this.set("downloading", percent);
  }
}

function node(tag: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG, tag) as SVGElement;
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  return element;
}
