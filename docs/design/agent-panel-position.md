# Agent panel position: bottom or right

Status: implemented (2026-11-24).

The agent panel (Claude Code in a terminal, `desktop/src/agentPanel.ts`)
docked only at the bottom of the window. That takes height, which is what
reading needs, while a wide window has width to spare: the text column stops
at the reading width (880 px by default) and the rest is margin. Claude
Code's output is also read line by line, so a tall, narrow panel shows more
of it than a wide, short one. The panel can now dock on the right as well.

## Decisions

| Question | Decision |
|---|---|
| Where it can go | At the bottom (as before) or on the right. Not the left: the document list is there |
| How it's chosen | **View → Agent Panel Position** (**Bottom** \| **Right**), and a button in the panel's header that moves it to the other side |
| Where it's kept | The app's view state (`view-state.json`, `folio.agentPanelPosition`), as the sidebar's width is: app state, not a setting to edit by hand. Bottom by default |
| What it spans on the right | From the window's top to the status bar, which stays full width under it, as in VS Code. Its header is as tall as the document's (`--header-height`), so the two line up |
| Size | 640 px wide by default (about 90 columns), at least 360. Drag its left edge to resize. The documents keep at least 520 px |
| A window too narrow for it | Narrower than 880 px (360 + 520), the panel shows at the bottom, and goes back to the right once the window is wide enough. The choice stays **Right**; the header's button is disabled, saying to widen the window |

## How the page makes room

The panel is a view of its own over the page (the page can't reach the
session, see `agentPanel.ts`). At the bottom, the page leaves a gap of the
panel's height above the status bar (`--agent-panel-height`). On the right,
it leaves a column of the panel's width beside the documents
(`--agent-panel-width`, `.agentSideSlot` in `App.module.css`). The main
process sets both as inserted CSS, then tells the page (`agent-panel:layout`).

What the page draws under the panel is covered, so:

- Overlays fixed to the window (dialogs, the drop overlay, the drawers'
  scrim, the diagram viewer, Settings) end before the panel on the right,
  as they end above it at the bottom.
- Popovers placed against the window's edge (hover cards, the filter menu,
  the document's note) use `visibleWidth()` in `viewport.ts`, the window's
  width less the panel's, as they use `visibleHeight()` for the bottom.
- The outline and the document list become drawers by the width the page
  has, not the window's (`useNarrowerThan` in `drawer.ts`, which replaced
  the max-width media queries). A 1440 px window with the panel on the right
  leaves 800 px: the outline becomes a drawer, as in an 800 px window.
