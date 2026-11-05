import { useEffect, useState } from "react";

const api = window.markdownApi;

/** Whether a drag carries files (not text or a link dragged out of the document). */
function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * Desktop app: dropping a markdown file or a folder on the window opens it
 * (see openPath in desktop/src/main.ts). Returns whether files are being
 * dragged over the window, for the drop overlay. Always false in the
 * browser, which can't open local paths.
 */
export default function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!api) return;
    const desktop = api;
    // dragenter/leave fire for every child element crossed; count to know when the drag leaves the window
    let depth = 0;

    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    }
    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      // Required for the drop to be allowed (and to stop Chromium opening the file itself)
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      const target = file ? desktop.getPathForFile(file) : "";
      if (target) void desktop.openPath(target);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return dragging;
}
