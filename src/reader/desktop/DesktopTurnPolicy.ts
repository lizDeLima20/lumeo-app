import { Capacitor } from "@capacitor/core";
import { PageGestureIntent } from "../page-turn/PageGestureIntent";

/** The mouse decides, not the window width. A narrow desktop window lays the book out as
 *  one page, but it is still driven by a mouse: gating on 64rem sent it down the phone's
 *  path, where a press on text never starts a turn. Phones report a coarse pointer and
 *  the Android app is native, so neither ever takes this path. */
export function usesDesktopMouseTurn(): boolean {
  return !Capacitor.isNativePlatform() && typeof matchMedia === "function"
    && matchMedia("(pointer: fine)").matches;
}

/** Holding Shift retains native text selection; controls and existing selections stay interactive. */
export function startsDesktopTurn(event: Pick<PointerEvent, "button" | "target" | "pointerType" | "shiftKey" | "detail">): boolean {
  if (event.pointerType !== "mouse") return PageGestureIntent.startsTurn(event);
  if (event.button !== 0 || event.shiftKey || event.detail > 1) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(PageGestureIntent.interactiveSelector)) return false;
  const selection = getSelection();
  return !selection || selection.isCollapsed || !selection.toString().trim();
}
