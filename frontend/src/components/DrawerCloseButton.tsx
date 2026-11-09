import React from "react";
import styles from "./DrawerCloseButton.module.css";

interface DrawerCloseButtonProps {
  /** The way the drawer slides out: « for the sidebar, » for the outline. */
  direction: "left" | "right";
  label: string;
  onClick: () => void;
}

/** Closes a drawer (narrow window), its arrows pointing the way it goes. */
export default function DrawerCloseButton({ direction, label, onClick }: DrawerCloseButtonProps): React.ReactElement {
  return (
    <button type="button" className={styles.button} onClick={onClick} aria-label={label} title={label}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={direction === "right" ? { transform: "scaleX(-1)" } : undefined}
      >
        <path d="M8 4L4 8l4 4M12.5 4l-4 4 4 4" />
      </svg>
    </button>
  );
}
