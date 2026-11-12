# FAQ

## Does Folio change my files?

No. Folio only reads your documents. Highlights, notes and bookmarks are kept
in Folio's own folder: `~/.folio`, or `%USERPROFILE%\.folio` on Windows.

## What happens to my marks when a document is edited?

They follow the text. If the passage a highlight was on is deleted, the
highlight is shown as not found in the Marks view, where you can remove it.

## Is Folio free?

Yes. Folio is free and open source under the MIT License.

<!-- TODO: once Pro ships, what stays free, what Pro adds, and a link to pricing -->

## Does Folio work offline?

Yes. Rendering, search, math, Mermaid diagrams and your marks all work
without a connection. Folio only goes online for two things:

- **Updates.** Shortly after launch, and every few hours, Folio checks
  GitHub Releases for a new version and downloads it in the background.
  You're asked to restart when it's ready, or it installs the next time you
  quit. Without a connection, the check just fails quietly.
- **Web images.** An image in a document with an `https://` address is
  loaded from the web, as in any Markdown viewer. Images from your own
  folders don't need a connection.

Links to websites open in your browser. Folio has no account, and sends no
analytics or usage data.

## Can I use it with an Obsidian vault?

Yes. Open the vault folder. Wiki links, image embeds and front matter work
as they do in Obsidian. See [Markdown support](./reference/markdown).

## Can I share my marks with someone else?

Not directly. Folio has no sync or shared workspace: your marks stay on your
computer. To share a review, send your notes as text:

1. Open the Send dialog with the header's clipboard button, or press `⇧⌘C` /
   `Ctrl+Shift+C` to copy the unsent notes straight away.
2. Paste the text wherever the review happens: a pull request comment, an
   issue, a chat message or a coding agent.

The text is Markdown. Each note comes with its quoted passage, section, file
path and line, so it still makes sense to someone who isn't using Folio.
Notes marked **Only me** and highlights without a note are left out. See
[Reviewing specs with a coding agent](./guide/review-loop).

The marks files in `~/.folio/marks` are JSON, one per document, but they're
keyed by each document's full path on your computer. They aren't meant to be
copied to someone else's computer.

## How do I back up my marks?

Back up the `~/.folio` folder (`%USERPROFILE%\.folio` on Windows). It holds
all your highlights, notes and bookmarks, for every folder you've opened.

## Where do I report a bug or ask for a feature?

On [GitHub Issues](https://github.com/crazzybot/folio/issues).
