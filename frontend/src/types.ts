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
