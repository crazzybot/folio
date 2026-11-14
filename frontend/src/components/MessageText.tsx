/**
 * MessageText.tsx — A note's or reply's text in its thread, as light
 * Markdown (docs/design/agent-integration.md): agents answer in Markdown, so
 * their bold, lists and code read as such.
 *
 * Formatting only. Raw HTML is dropped, images show their alt text, and
 * links are text with the address in their tooltip: a message never loads
 * or opens anything. No diagrams, math or highlighting either. The text is
 * untrusted, so it's sanitised as the document is.
 */

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import styles from "./MessageText.module.css";

// Headings would outshout the thread: they read as a bold line
const heading: Components["h1"] = ({ children }) => (
  <p>
    <strong>{children}</strong>
  </p>
);

const components: Components = {
  a: ({ children, href }) => (
    <span className={styles.link} title={href}>
      {children}
    </span>
  ),
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
};

export default function MessageText({ text }: { text: string }): React.ReactElement {
  return (
    <div className={styles.message}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, defaultSchema]]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
