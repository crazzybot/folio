# Code Demo

This document demonstrates syntax-highlighted fenced code blocks rendered by the previewer.

## Python example

```python
from dataclasses import dataclass, field


@dataclass
class Document:
    id: str
    title: str
    location: str
    tags: list[str] = field(default_factory=list)

    def summary(self) -> str:
        tag_str = ", ".join(self.tags) if self.tags else "none"
        return f"{self.title} ({self.location}) — tags: {tag_str}"


doc = Document(id="abc123", title="Code Demo", location="samples/code-demo.md")
print(doc.summary())
```

## JSON example

```json
{
  "id": "abc123",
  "title": "Code Demo",
  "location": "samples/code-demo.md",
  "created": "2026-07-11T22:08:00Z",
  "tags": []
}
```
