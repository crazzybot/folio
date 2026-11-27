// Prints the ID of the main window of process <pid>, for `screencapture -l`:
// its largest on-screen window, so the agent panel or a popup isn't picked.
// drive.mjs passes the process that listens on the CDP port; the owner name
// can't tell it apart, since the user's own dev build is "Electron" too.
// Exits 1 when there is none.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count > 1, let pid = Int(CommandLine.arguments[1]) else {
  FileHandle.standardError.write("usage: window-id <pid>\n".data(using: .utf8)!)
  exit(2)
}
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
  as? [[String: Any]] ?? []

var best: (id: Int, area: Double)? = nil
for window in list {
  guard window[kCGWindowOwnerPID as String] as? Int == pid,
        window[kCGWindowLayer as String] as? Int == 0,
        let id = window[kCGWindowNumber as String] as? Int,
        let bounds = window[kCGWindowBounds as String] as? [String: Double] else { continue }
  let area = (bounds["Width"] ?? 0) * (bounds["Height"] ?? 0)
  if best == nil || area > best!.area { best = (id, area) }
}

guard let found = best else { exit(1) }
print(found.id)
