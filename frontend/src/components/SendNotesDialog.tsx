import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReviewNotes } from "../reviewNotes";
import { defaultSelection, picked } from "../sending";
import type { Picked, SendGroup, SendItem } from "../sending";
import { getItem, setItem } from "../storage";
import styles from "./SendNotesDialog.module.css";

const IS_MAC = window.markdownApi?.platform === "darwin" || navigator.platform.toUpperCase().includes("MAC");
const TAB_KEY = "folio.sendDialogTab";

/**
 * Write `text` to the clipboard. False when the page can't: outside a secure
 * context (a page served over plain HTTP) there's no clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!window.isSecureContext || navigator.clipboard === undefined) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A clipboard with lines of notes: the Copy review notes buttons. */
export function ReviewNotesIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 2.5h-2v12h9v-12h-2" />
      <rect x="5.5" y="1.5" width="5" height="2" rx="0.5" />
      <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" strokeLinecap="round" />
    </svg>
  );
}

interface SendNotesDialogProps {
  /** What the notes are from: the file name, or "3 documents". */
  title: string;
  groups: readonly SendGroup[];
  /** The text the agent gets for the ticked notes. */
  format: (picks: readonly Picked[]) => ReviewNotes;
  /** Don't send these notes again: copying makes them sent. */
  markSent: boolean;
  onMarkSentChange: (on: boolean) => void;
  /** The ticked notes were copied (or, without a clipboard, selected to copy): record it. */
  onSent: (picks: readonly Picked[], markSent: boolean) => void;
  onClose: () => void;
  /** Go to a note (the dialog closes); null: the note on the document as a whole. */
  onOpenNote: (docId: string, highlightId: string | null) => void;
  /** Only me: the note leaves the list. */
  onMakePrivate: (item: SendItem) => void;
  /** Show the counted, unlisted notes in the Marks view. */
  onShowPrivate: () => void;
  onShowUnplaced: () => void;
}

// How long the check shows before the dialog closes
const COPIED_MS = 600;

/**
 * Send review notes (notes/01a-sending-notes.md §3): the notes from where
 * it was opened, as a list to tick, and the exact Markdown the agent gets
 * in the Text tab. Notes not sent yet are ticked; sent ones with no answer
 * are offered apart; private and out-of-date ones are only counted. Copy
 * puts the text on the clipboard and records the round; with **Don't send
 * these notes again**, the notes become sent.
 */
export default function SendNotesDialog({
  title,
  groups,
  format,
  markSent,
  onMarkSentChange,
  onSent,
  onClose,
  onOpenNote,
  onMakePrivate,
  onShowPrivate,
  onShowUnplaced,
}: SendNotesDialogProps): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const titleId = useId();
  const [tab, setTab] = useState<"list" | "text">(() => (getItem(TAB_KEY) === "text" ? "text" : "list"));
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => defaultSelection(groups));
  const [showSent, setShowSent] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const recorded = useRef(false);

  // Notes made private (or removed) since opening leave the selection
  const keys = useMemo(() => new Set(groups.flatMap((g) => [...g.items, ...g.sentBefore].map((i) => i.key))), [groups]);
  const selected = useMemo(() => new Set([...chosen].filter((k) => keys.has(k))), [chosen, keys]);
  const picks = useMemo(() => picked(groups, selected), [groups, selected]);
  const notes = useMemo(() => format(picks), [format, picks]);
  const count = picks.reduce((n, p) => n + p.highlights.length + (p.note === undefined ? 0 : 1), 0);
  const sentBefore = groups.reduce((n, g) => n + g.sentBefore.length, 0);
  const privateCount = groups.reduce((n, g) => n + g.privateCount, 0);
  const unplacedCount = groups.reduce((n, g) => n + g.unplacedCount, 0);

  // Focus Copy (the dialog itself when there's nothing to copy, so Escape
  // still closes it); give focus back to what opened the dialog on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const copyButton = copyRef.current;
    if (copyButton !== null && !copyButton.disabled) copyButton.focus();
    else dialogRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(onClose, COPIED_MS);
    return () => clearTimeout(timer);
  }, [status, onClose]);

  const chooseTab = (next: "list" | "text") => {
    setTab(next);
    setItem(TAB_KEY, next);
  };

  const toggle = (itemKeys: readonly string[], on: boolean) => {
    setChosen((prev) => {
      const next = new Set(prev);
      for (const key of itemKeys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const record = () => {
    if (recorded.current) return;
    recorded.current = true;
    onSent(picks, markSent);
  };

  const copy = () => {
    if (count === 0) return;
    void copyText(notes.text).then((ok) => {
      if (ok) {
        record();
        setStatus("copied");
        return;
      }
      // No clipboard: show the text selected, for the user to copy
      setTab("text");
      setStatus("manual");
      record();
    });
  };

  // Without a clipboard, the text is selected once the Text tab shows it
  useLayoutEffect(() => {
    if (status !== "manual" || tab !== "text") return;
    const pre = textRef.current;
    const selection = window.getSelection();
    if (pre === null || selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(pre);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [status, tab]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && !(target instanceof HTMLButtonElement)) {
      e.preventDefault();
      copy();
      return;
    }
    // Keep Tab inside the dialog
    if (e.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, input") ?? [])].filter(
      (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  // In the list: arrows move between checkboxes, `p` makes the note private
  function onListKeyDown(e: React.KeyboardEvent) {
    const boxes = [...(listRef.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? [])];
    const at = boxes.indexOf(e.target as HTMLInputElement);
    if (at === -1) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      boxes[Math.max(0, Math.min(boxes.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (e.key === "p" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const key = (e.target as HTMLElement).dataset.item;
      const item = groups.flatMap((g) => [...g.items, ...g.sentBefore]).find((i) => i.key === key);
      if (item === undefined) return;
      e.preventDefault();
      boxes[at + 1]?.focus();
      onMakePrivate(item);
    }
  }

  const docs = picks.length;
  const row = (item: SendItem) => (
    <ItemRow
      key={item.key}
      item={item}
      checked={selected.has(item.key)}
      onToggle={(on) => toggle([item.key], on)}
      onOpen={() => onOpenNote(item.docId, item.highlight?.id ?? null)}
      onMakePrivate={() => onMakePrivate(item)}
    />
  );

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Send review notes <span className={styles.subject}>· {title}</span>
          </h2>
          <div className={styles.tabs} role="tablist" aria-label="Show">
            {(["list", "text"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`${styles.tab} ${tab === t ? styles.tabOn : ""}`}
                onClick={() => chooseTab(t)}
              >
                {t === "list" ? "List" : "Text"}
              </button>
            ))}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close" title="Close (Escape)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.3" />
            </svg>
          </button>
        </header>

        {tab === "list" ? (
          <div ref={listRef} className={styles.list} onKeyDown={onListKeyDown}>
            {groups.every((g) => g.items.length === 0) && (
              <p className={styles.empty}>Nothing new to send. Notes sent before are below.</p>
            )}
            {groups
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <GroupRows key={g.doc.id} group={g} items={g.items} selected={selected} onToggle={toggle}>
                  {g.items.map(row)}
                </GroupRows>
              ))}

            {sentBefore > 0 && (
              <section className={styles.sentBefore}>
                <button type="button" className={styles.disclosure} onClick={() => setShowSent(!showSent)} aria-expanded={showSent}>
                  <span className={`${styles.chevron} ${showSent ? styles.chevronOpen : ""}`} aria-hidden="true">
                    ›
                  </span>
                  Sent before ({sentBefore}) · not included unless ticked
                </button>
                {showSent &&
                  groups
                    .filter((g) => g.sentBefore.length > 0)
                    .map((g) => (
                      <GroupRows key={g.doc.id} group={g} items={g.sentBefore} selected={selected} onToggle={toggle}>
                        {g.sentBefore.map(row)}
                      </GroupRows>
                    ))}
              </section>
            )}

            {(unplacedCount > 0 || privateCount > 0) && (
              <p className={styles.counts}>
                {unplacedCount > 0 && (
                  <button type="button" className={styles.linkBtn} onClick={onShowUnplaced} title="Show them in the Marks view">
                    {unplacedCount} not found in the current text
                  </button>
                )}
                {unplacedCount > 0 && privateCount > 0 && " · "}
                {privateCount > 0 && (
                  <button type="button" className={styles.linkBtn} onClick={onShowPrivate} title="Show them in the Marks view">
                    {privateCount} private, not shown
                  </button>
                )}
              </p>
            )}
          </div>
        ) : (
          <TextView ref={textRef} notes={notes} onOpenNote={(docId, highlightId) => onOpenNote(docId, highlightId)} />
        )}

        <footer className={styles.footer}>
          <label className={styles.markSent} title="Copied notes become sent, and aren't ticked next time">
            <input type="checkbox" checked={markSent} onChange={(e) => onMarkSentChange(e.target.checked)} />
            Don't send these notes again
          </label>
          {status === "manual" ? (
            <span className={styles.hint} role="status">
              Press {IS_MAC ? "⌘C" : "Ctrl+C"} to copy
            </span>
          ) : (
            <span className={styles.hint}>
              {count} note{count !== 1 ? "s" : ""}
              {docs > 1 ? ` · ${docs} docs` : ""}
            </span>
          )}
          <button ref={copyRef} type="button" className={styles.primaryBtn} onClick={copy} disabled={count === 0}>
            {status === "copied" ? (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M3 8.5l3.5 3.5L13 4.5" />
                </svg>
                Copied
              </>
            ) : (
              "Copy"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** A document's title, with a checkbox for all its listed notes, then the notes. */
function GroupRows({
  group,
  items,
  selected,
  onToggle,
  children,
}: {
  group: SendGroup;
  items: readonly SendItem[];
  selected: ReadonlySet<string>;
  onToggle: (keys: readonly string[], on: boolean) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const boxRef = useRef<HTMLInputElement>(null);
  const ticked = items.filter((i) => selected.has(i.key)).length;
  const folder = group.doc.location.includes("/") ? group.doc.location.slice(0, group.doc.location.lastIndexOf("/")) : "";
  useLayoutEffect(() => {
    if (boxRef.current !== null) boxRef.current.indeterminate = ticked > 0 && ticked < items.length;
  });
  return (
    <section className={styles.group}>
      <label className={styles.groupHeader} title={group.doc.location}>
        <input
          ref={boxRef}
          type="checkbox"
          checked={ticked === items.length}
          onChange={(e) => onToggle(items.map((i) => i.key), e.target.checked)}
        />
        <span className={styles.docTitle}>{group.doc.title}</span>
        <span className={styles.docMeta}>
          {folder !== "" && `${folder} · `}
          {ticked} of {items.length}
        </span>
      </label>
      <ul className={styles.items}>{children}</ul>
    </section>
  );
}

/** A note to tick: its colour, quote and note, as in the Marks view. */
function ItemRow({
  item,
  checked,
  onToggle,
  onOpen,
  onMakePrivate,
}: {
  item: SendItem;
  checked: boolean;
  onToggle: (on: boolean) => void;
  onOpen: () => void;
  onMakePrivate: () => void;
}): React.ReactElement {
  const h = item.highlight;
  const note = item.note;
  return (
    <li className={styles.item}>
      <label className={styles.itemLabel}>
        <input type="checkbox" data-item={item.key} checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        {h !== null ? (
          <>
            <span className={styles.colorBar} style={{ background: `var(--mark-${h.color}-swatch)` }} aria-hidden="true" />
            <span className={styles.itemBody}>
              <span className={styles.quote}>“{h.quote.exact}”</span>
              <span className={styles.itemNote}>{h.note?.trim() ? h.note : "(no comment)"}</span>
            </span>
          </>
        ) : (
          <>
            <span className={styles.docMark} aria-hidden="true">
              ◆
            </span>
            <span className={styles.itemBody}>
              {note?.requestedStatus != null && <span className={styles.quote}>Document: change status to {note.requestedStatus}</span>}
              {note?.text != null && <span className={styles.itemNote}>{note.text}</span>}
            </span>
          </>
        )}
      </label>
      <span className={styles.rowActions}>
        {(h !== null || note?.text != null) && (
          <button
            type="button"
            className={styles.rowBtn}
            onClick={onMakePrivate}
            title={h === null ? "Keep the comment to yourself (a status change is still sent) · P" : "Keep this note to yourself: it's never sent · P"}
          >
            Only me
          </button>
        )}
        <button type="button" className={styles.rowBtn} onClick={onOpen} aria-label="Go to the note" title="Go to the note">
          ↗
        </button>
      </span>
    </li>
  );
}

/** The exact Markdown the agent gets; clicking a note goes to it. */
const TextView = React.forwardRef<HTMLPreElement, { notes: ReviewNotes; onOpenNote: (docId: string, highlightId: string) => void }>(
  function TextView({ notes, onOpenNote }, ref) {
    // The text as runs of lines: a note's lines (clickable) or the lines between
    const lines = notes.text.split("\n");
    const runs: { note?: (typeof notes.notes)[number]; text: string }[] = [];
    let at = 0;
    for (const note of notes.notes) {
      if (note.lines.start > at) runs.push({ text: lines.slice(at, note.lines.start).join("\n") + "\n" });
      runs.push({ note, text: lines.slice(note.lines.start, note.lines.end).join("\n") + "\n" });
      at = note.lines.end;
    }
    if (at < lines.length) runs.push({ text: lines.slice(at).join("\n") });
    return (
      <pre ref={ref} className={styles.text} aria-label="Text to copy">
        {runs.map((run, i) =>
          run.note === undefined ? (
            <span key={i}>{run.text}</span>
          ) : (
            // A span, not a button: Chromium won't select a button's text,
            // and the text must stay selectable for ⌘C
            <span
              key={i}
              className={styles.note}
              onClick={() => run.note && onOpenNote(run.note.docId, run.note.highlightId)}
              title="Go to this highlight"
            >
              {run.text}
            </span>
          ),
        )}
      </pre>
    );
  },
);
