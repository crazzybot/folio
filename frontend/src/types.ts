export interface DocumentMeta {
  id: string;
  filename: string;
  location: string; // relative path from workspace root
  title: string;
  created: string; // ISO-8601
}

export interface DocumentContent {
  id: string;
  content: string;
}

export type PanelSide = "left" | "right";

/** Whether the desktop window's history has entries behind / ahead of the current one. */
export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}
