import Foundation

/// Files for the client core, confined to River's own containers: Application
/// Support (excluded from iCloud backup: it is useless without this device's
/// Keychain) and Caches. A file the person chose to export is written under
/// cache/export/ and then handed to iOS's "Save to Files" sheet.
final class FileOps {
    let data: URL
    let cache: URL
    var onExported: ((URL) -> Void)?
    private var exports = Set<String>()
    private var nextExport = 1

    init() throws {
        let fm = FileManager.default
        var support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("River", isDirectory: true)
        try fm.createDirectory(at: support, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try support.setResourceValues(values)
        data = support.standardizedFileURL
        cache = try fm.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("River", isDirectory: true).standardizedFileURL
        try fm.createDirectory(at: cache, withIntermediateDirectories: true)
    }

    /// A path the core may write once; the file is then offered to the person.
    func exportTarget(name: String) -> String {
        var safe = name.replacingOccurrences(of: "[^A-Za-z0-9._ -]", with: "_", options: .regularExpression)
        if safe.isEmpty || safe.hasPrefix(".") { safe = "file" + safe }
        let dir = cache.appendingPathComponent("export/\(nextExport)", isDirectory: true)
        nextExport += 1
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent(safe).path
        exports.insert(path)
        return path
    }

    private func confine(_ path: String) throws -> URL {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let p = url.path
        for root in [data.path, cache.path] where p == root || p.hasPrefix(root + "/") {
            return url
        }
        throw NativeFailure("outside app storage: \(path)", code: "EACCES")
    }

    private func enoent(_ path: String) -> NativeFailure {
        NativeFailure("no such file or directory: \(path)", code: "ENOENT")
    }

    func call(_ method: String, _ a: [String: Any]) throws -> Any {
        let fm = FileManager.default
        switch method {
        case "fs.paths":
            return [
                "data": data.path,
                "cache": cache.path,
                "documents": data.appendingPathComponent("documents").path,
                "downloads": data.appendingPathComponent("downloads").path,
            ] as [String: Any]
        case "fs.read":
            let path = try a.string("path")
            let url = try confine(path)
            guard let d = fm.contents(atPath: url.path) else { throw enoent(path) }
            return d.b64
        case "fs.write":
            let path = try a.string("path")
            let url = try confine(path)
            let bytes = try a.bytes("data")
            guard fm.fileExists(atPath: url.deletingLastPathComponent().path) else { throw enoent(path) }
            if a.bool("append"), let h = try? FileHandle(forWritingTo: url) {
                defer { try? h.close() }
                try h.seekToEnd()
                try h.write(contentsOf: bytes)
            } else {
                try bytes.write(to: url, options: [.atomic])
            }
            if exports.remove(url.path) != nil { onExported?(url) }
            return NSNull()
        case "fs.stat":
            let url = try confine(try a.string("path"))
            var dir: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &dir) else { return NSNull() }
            let attrs = try fm.attributesOfItem(atPath: url.path)
            let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
            let mtime = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            return ["size": size, "mtimeMs": mtime * 1000, "dir": dir.boolValue] as [String: Any]
        case "fs.list":
            let path = try a.string("path")
            let url = try confine(path)
            guard let names = try? fm.contentsOfDirectory(atPath: url.path) else { throw enoent(path) }
            return names
        case "fs.mkdir":
            try fm.createDirectory(at: try confine(try a.string("path")), withIntermediateDirectories: true)
            return NSNull()
        case "fs.rename":
            let from = try confine(try a.string("from"))
            let to = try confine(try a.string("to"))
            guard fm.fileExists(atPath: from.path) else { throw enoent(from.path) }
            if fm.fileExists(atPath: to.path) { try fm.removeItem(at: to) }
            try fm.moveItem(at: from, to: to)
            return NSNull()
        case "fs.remove":
            let url = try confine(try a.string("path"))
            guard fm.fileExists(atPath: url.path) else { throw enoent(url.path) }
            var dir: ObjCBool = false
            fm.fileExists(atPath: url.path, isDirectory: &dir)
            if dir.boolValue && !a.bool("recursive"),
                let children = try? fm.contentsOfDirectory(atPath: url.path), !children.isEmpty
            {
                throw NativeFailure("directory not empty", code: "ENOTEMPTY")
            }
            try fm.removeItem(at: url)
            return NSNull()
        case "fs.copy":
            let from = try confine(try a.string("from"))
            let to = try confine(try a.string("to"))
            guard fm.fileExists(atPath: from.path) else { throw enoent(from.path) }
            if fm.fileExists(atPath: to.path) { try fm.removeItem(at: to) }
            try fm.copyItem(at: from, to: to)
            return NSNull()
        default:
            throw NativeFailure("unknown native method \(method)")
        }
    }
}
