import React from "react";
import { isWebUrl } from "../frontMatter";
import type { FrontMatter, FrontMatterProperty } from "../frontMatter";
import { FRONT_MATTER_VIEWS } from "../readerPrefs";
import type { FrontMatterView } from "../readerPrefs";
import styles from "./FrontMatterPanel.module.css";

interface FrontMatterPanelProps {
  id: string;
  frontMatter: FrontMatter;
  view: FrontMatterView;
  onView: (id: FrontMatterView["id"]) => void;
}

/** One value as text: never Markdown or HTML, a link only when it is one web address. */
function Text({ text }: { text: string }): React.ReactElement {
  if (!isWebUrl(text)) return <>{text}</>;
  return (
    <a className={styles.link} href={text} target="_blank" rel="noopener noreferrer" title={`${text} (opens in browser)`}>
      {text}
    </a>
  );
}

function Value({ property }: { property: FrontMatterProperty }): React.ReactElement {
  const { value, raw } = property;
  if (typeof value === "string") return <Text text={value} />;
  if (Array.isArray(value)) {
    return (
      <>
        {value.map((item, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className={styles.separator}> · </span>}
            <Text text={item} />
          </React.Fragment>
        ))}
      </>
    );
  }
  if (raw === "") return <span className={styles.empty}>—</span>;
  return <pre className={styles.raw}>{raw}</pre>;
}

/**
 * The whole front matter, under the properties strip: every top-level key
 * as a table, or the block as written (docs/design/frontmatter-properties.md).
 * Outside the article, so highlights' text positions don't count it.
 */
export default function FrontMatterPanel({ id, frontMatter, view, onView }: FrontMatterPanelProps): React.ReactElement {
  // TOML, or YAML with only comments: there's no table to show
  const tableless = frontMatter.format === "toml" || frontMatter.properties.length === 0;
  const shown = tableless ? "source" : view.id;

  return (
    <div id={id} className={styles.panel} role="region" aria-label="Front matter">
      <div className={styles.views} role="group" aria-label="Show front matter as">
        {tableless ? (
          <span className={styles.format}>{frontMatter.format === "toml" ? "TOML" : "YAML"}</span>
        ) : (
          FRONT_MATTER_VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`${styles.view} ${shown === option.id ? styles.viewOn : ""}`}
              aria-pressed={shown === option.id}
              onClick={() => onView(option.id)}
            >
              {option.label}
            </button>
          ))
        )}
      </div>
      <div className={styles.body}>
        {shown === "table" ? (
          <dl className={styles.table}>
            {frontMatter.properties.map((property, index) => (
              <div key={index} className={styles.row}>
                <dt className={styles.key}>{property.key}</dt>
                <dd className={styles.value}>
                  <Value property={property} />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <pre className={styles.source}>
            <code>{frontMatter.block}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
