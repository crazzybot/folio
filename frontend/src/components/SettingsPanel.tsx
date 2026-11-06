import React, { useEffect, useId, useRef, useState } from "react";
import type { DesktopSettings } from "../desktop";
import { DOC_STYLES, FONT_SIZES, READING_WIDTHS } from "../readerPrefs";
import type { DocStyle, FontSize, ReadingWidth } from "../readerPrefs";
import { THEME_OPTIONS } from "../theme";
import type { ThemePreference } from "../theme";
import styles from "./SettingsPanel.module.css";

const desktop = window.markdownApi;
const IS_MAC = desktop?.platform === "darwin";

interface SettingsPanelProps {
  onClose: () => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  docStyle: DocStyle["id"];
  onDocStyleChange: (id: DocStyle["id"]) => void;
  readingWidth: ReadingWidth["id"];
  onReadingWidthChange: (id: ReadingWidth["id"]) => void;
  fontSize: FontSize["id"];
  onFontSizeChange: (id: FontSize["id"]) => void;
  groupByFolder: boolean;
  onGroupByFolderChange: (on: boolean) => void;
  showOutline: boolean;
  onShowOutlineChange: (on: boolean) => void;
  searchDocumentText: boolean;
  onSearchDocumentTextChange: (on: boolean) => void;
}

/**
 * Settings (⌘, / the gear in the status bar): the view preferences, shared
 * with the header and sidebar controls, and in the desktop app the
 * workspace, scanning and editor settings kept in settings.json.
 */
export default function SettingsPanel(props: SettingsPanelProps): React.ReactElement {
  const { onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus the dialog; give focus back to what opened it on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // The first setting (the theme's selected option), not the close button
    // (querySelector with a list returns the first in document order, so ask in turn)
    const dialog = dialogRef.current;
    (dialog?.querySelector<HTMLElement>("[role=radio][tabindex='0']") ?? dialog?.querySelector<HTMLElement>("button"))?.focus();
    return () => opener?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    // Keep Tab inside the dialog
    if (e.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>("button, input, [tabindex='0']") ?? []),
    ].filter((el) => !el.hasAttribute("disabled"));
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

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Settings
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close settings" title="Close (Escape)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.3" />
            </svg>
          </button>
        </header>

        <div className={styles.body}>
          <Section title="Appearance">
            <Choice label="Theme" options={THEME_OPTIONS} value={props.theme} onChange={props.onThemeChange} />
            <Choice label="Document style" options={DOC_STYLES} value={props.docStyle} onChange={props.onDocStyleChange} />
            <Choice label="Reading width" options={READING_WIDTHS} value={props.readingWidth} onChange={props.onReadingWidthChange} />
            <Choice label="Font size" options={FONT_SIZES} value={props.fontSize} onChange={props.onFontSizeChange} />
          </Section>

          <Section title="Sidebar and outline">
            <Toggle label="Group documents by folder" checked={props.groupByFolder} onChange={props.onGroupByFolderChange} />
            <Toggle label="Show the outline beside the document" checked={props.showOutline} onChange={props.onShowOutlineChange} />
            <Toggle
              label="Search document text, not just titles and headings"
              hint={IS_MAC ? "Also ⇧⌘F" : "Also Ctrl+Shift+F"}
              checked={props.searchDocumentText}
              onChange={props.onSearchDocumentTextChange}
            />
          </Section>

          {desktop && <DesktopSettingsSections />}
        </div>
      </div>
    </div>
  );
}

// ─── Desktop: settings.json ──────────────────────────────────────────────────

function DesktopSettingsSections(): React.ReactElement | null {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const api = desktop?.settings;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.get().then((s) => {
      if (!cancelled) setSettings(s);
    });
    // Also follows changes made elsewhere: settings.json, Open Folder…
    const unsubscribe = api.onChange(setSettings);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  if (!api || settings === null) return null;
  const update = (patch: Parameters<typeof api.set>[0]) => void api.set(patch).then(setSettings);

  return (
    <>
      <Section title="Workspace">
        <div className={styles.row}>
          <span className={styles.label}>Folder</span>
          <div className={styles.folderRow}>
            <span className={styles.path} title={settings.workspace ?? undefined}>
              {/* Isolated left-to-right, so the right-to-left cut doesn't move the leading "/" */}
              <bdi>{settings.workspace ?? "None chosen"}</bdi>
            </span>
            <button type="button" className={styles.button} onClick={() => void api.chooseWorkspace()}>
              Change…
            </button>
          </div>
        </div>
        <SkipDirs
          value={settings.skipDirs}
          defaults={settings.defaultSkipDirs}
          onChange={(skipDirs) => update({ skipDirs })}
        />
        <ScanDepth value={settings.maxDepth} onChange={(maxDepth) => update({ maxDepth })} />
      </Section>

      <Section title="Editor">
        <TextSetting
          label="Open in Editor uses"
          hint={IS_MAC ? 'An app name, e.g. "Cursor"' : 'A command, e.g. "code"'}
          placeholder={settings.detectedEditor ?? (IS_MAC ? "Default text editor" : "Default app")}
          value={settings.editor ?? ""}
          onCommit={(value) => update({ editor: value.trim() === "" ? null : value.trim() })}
        />
        <div className={styles.row}>
          <span className={styles.label}>Custom CSS</span>
          <button type="button" className={styles.button} onClick={() => void api.editCustomCss()}>
            Edit custom.css…
          </button>
        </div>
      </Section>

      <footer className={styles.footer}>
        <button type="button" className={styles.linkBtn} onClick={() => void api.openFile()}>
          Open settings.json
        </button>
      </footer>
    </>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

interface ChoiceProps<T extends string> {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}

/** A segmented radio group: one button per option, arrow keys move between them. */
function Choice<T extends string>({ label, options, value, onChange }: ChoiceProps<T>): React.ReactElement {
  const labelId = useId();
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    if (next === undefined) return;
    onChange(next.id);
    (e.currentTarget.parentElement?.children[(index + step + options.length) % options.length] as HTMLElement | undefined)?.focus();
  }
  return (
    <div className={styles.row}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <div className={styles.segmented} role="radiogroup" aria-labelledby={labelId}>
        {options.map((option, i) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            tabIndex={option.id === value ? 0 : -1}
            className={styles.segment}
            onClick={() => onChange(option.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}

function Toggle({ label, hint, checked, onChange }: ToggleProps): React.ReactElement {
  const id = useId();
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.toggleLabel}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className={styles.switch}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

interface TextSettingProps {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onCommit: (value: string) => void;
}

/** A text field saved when it loses focus or on Enter. */
function TextSetting({ label, hint, placeholder, value, onCommit }: TextSettingProps): React.ReactElement {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.toggleLabel}>
        {label}
        <span className={styles.hint}>{hint}</span>
      </label>
      <input
        id={id}
        type="text"
        className={styles.input}
        placeholder={placeholder}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </div>
  );
}

interface SkipDirsProps {
  value: string[];
  defaults: string[];
  onChange: (names: string[]) => void;
}

/** Folder names skipped while scanning: removable chips and a field to add one. */
function SkipDirs({ value, defaults, onChange }: SkipDirsProps): React.ReactElement {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const isDefault = value.length === defaults.length && defaults.every((name) => value.includes(name));
  const add = () => {
    // Folder names, not paths: "docs/build" can't match a folder name
    const name = draft.trim().replace(/^\/+|\/+$/g, "");
    if (name === "" || name.includes("/") || value.includes(name)) return;
    onChange([...value, name]);
    setDraft("");
  };
  return (
    <div className={styles.block}>
      <div className={styles.blockHeader}>
        <label htmlFor={inputId} className={styles.label}>
          Skipped folders
          <span className={styles.hint}>Folder names skipped wherever they appear</span>
        </label>
        {!isDefault && (
          <button type="button" className={styles.linkBtn} onClick={() => onChange([...defaults])}>
            Reset to default
          </button>
        )}
      </div>
      <ul className={styles.chips} aria-label="Skipped folders">
        {value.map((name) => (
          <li key={name} className={styles.chip}>
            {name}
            <button
              type="button"
              className={styles.chipRemove}
              onClick={() => onChange(value.filter((n) => n !== name))}
              aria-label={`Stop skipping ${name}`}
              title={`Stop skipping ${name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.addRow}>
        <input
          id={inputId}
          type="text"
          className={styles.input}
          placeholder="Folder name, e.g. dist"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={styles.button} onClick={add} disabled={draft.trim() === ""}>
          Add
        </button>
      </div>
    </div>
  );
}

/** How many folder levels to scan; empty = unlimited. */
function ScanDepth({ value, onChange }: { value: number | null; onChange: (depth: number | null) => void }): React.ReactElement {
  const id = useId();
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const depth = draft.trim() === "" ? null : Math.floor(Number(draft));
    const next = depth !== null && Number.isFinite(depth) && depth > 0 ? depth : null;
    if (next !== value) onChange(next);
    else setDraft(value === null ? "" : String(value));
  };
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.toggleLabel}>
        Scan depth
        <span className={styles.hint}>Folder levels below the workspace (docs/guide.md is 1); empty for unlimited</span>
      </label>
      <input
        id={id}
        type="number"
        min={1}
        className={`${styles.input} ${styles.numberInput}`}
        placeholder="Unlimited"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </div>
  );
}
