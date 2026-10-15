import Foundation
import SQLCipher

/// River's local database on iOS: SQLCipher 4 (the same format and settings as
/// the desktop's), keyed with a raw 32-byte key. One statement per call; the
/// core splits scripts and drives transactions itself.
final class DbOps {
    private var open: [Int: OpaquePointer] = [:]
    private var next = 1
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private func db(_ a: [String: Any]) throws -> OpaquePointer {
        guard let db = open[try a.int("db")] else { throw NativeFailure("database is closed", code: "SQLITE_MISUSE") }
        return db
    }

    private func failure(_ db: OpaquePointer?, _ rc: Int32) -> NativeFailure {
        let message = db.flatMap { sqlite3_errmsg($0) }.map { String(cString: $0) } ?? "SQLite error \(rc)"
        let code: String
        switch rc & 0xFF {
        case SQLITE_NOTADB: code = "SQLITE_NOTADB"
        case SQLITE_CONSTRAINT: code = "SQLITE_CONSTRAINT"
        default: code = "SQLITE_ERROR"
        }
        return NativeFailure(message, code: code)
    }

    private func prepare(_ db: OpaquePointer, _ sql: String, _ params: [Any]) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        let rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nil)
        guard rc == SQLITE_OK, let s = stmt else { throw failure(db, rc) }
        for (i, p) in params.enumerated() {
            let idx = Int32(i + 1)
            if p is NSNull {
                sqlite3_bind_null(s, idx)
            } else if let o = p as? [String: Any], let b64 = o["$b"] as? String, let d = Data(base64Encoded: b64) {
                _ = d.withUnsafeBytes { sqlite3_bind_blob(s, idx, $0.baseAddress, Int32(d.count), transient) }
            } else if let n = p as? NSNumber {
                let d = n.doubleValue
                if CFNumberIsFloatType(n as CFNumber) && d != d.rounded() {
                    sqlite3_bind_double(s, idx, d)
                } else {
                    sqlite3_bind_int64(s, idx, n.int64Value)
                }
            } else if let str = p as? String {
                sqlite3_bind_text(s, idx, str, -1, transient)
            } else {
                sqlite3_finalize(s)
                throw NativeFailure("SQLite3 can only bind numbers, strings, buffers and null")
            }
        }
        return s
    }

    func call(_ method: String, _ a: [String: Any]) throws -> Any {
        switch method {
        case "db.open":
            var handle: OpaquePointer?
            let path = try a.string("path")
            var rc = sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
            guard rc == SQLITE_OK, let db = handle else {
                let f = failure(handle, rc)
                sqlite3_close(handle)
                throw f
            }
            // SQLCipher reads a key given as x'…' as the raw key, exactly as PRAGMA key does on the desktop.
            let hex = try a.bytes("key").map { String(format: "%02x", $0) }.joined()
            let key = "x'\(hex)'"
            rc = sqlite3_key(db, key, Int32(key.utf8.count))
            if rc == SQLITE_OK { rc = sqlite3_exec(db, "SELECT count(*) FROM sqlite_master", nil, nil, nil) }
            guard rc == SQLITE_OK else {
                let f = failure(db, rc)
                sqlite3_close(db)
                throw f
            }
            let id = next
            next += 1
            open[id] = db
            return id
        case "db.close":
            if let db = open.removeValue(forKey: try a.int("db")) { sqlite3_close(db) }
            return NSNull()
        case "db.run":
            let db = try db(a)
            let stmt = try prepare(db, try a.string("sql"), a.array("params"))
            defer { sqlite3_finalize(stmt) }
            var rc = sqlite3_step(stmt)
            while rc == SQLITE_ROW { rc = sqlite3_step(stmt) }
            guard rc == SQLITE_DONE else { throw failure(db, rc) }
            return ["changes": Int(sqlite3_changes(db)), "lastInsertRowid": Int(sqlite3_last_insert_rowid(db))] as [String: Any]
        case "db.all":
            let db = try db(a)
            let stmt = try prepare(db, try a.string("sql"), a.array("params"))
            defer { sqlite3_finalize(stmt) }
            let count = sqlite3_column_count(stmt)
            let columns = (0..<count).map { String(cString: sqlite3_column_name(stmt, $0)) }
            var rows: [[Any]] = []
            var rc = sqlite3_step(stmt)
            while rc == SQLITE_ROW {
                var row: [Any] = []
                for i in 0..<count {
                    switch sqlite3_column_type(stmt, i) {
                    case SQLITE_INTEGER: row.append(sqlite3_column_int64(stmt, i))
                    case SQLITE_FLOAT: row.append(sqlite3_column_double(stmt, i))
                    case SQLITE_TEXT: row.append(String(cString: sqlite3_column_text(stmt, i)))
                    case SQLITE_BLOB:
                        let n = Int(sqlite3_column_bytes(stmt, i))
                        let d = n == 0 ? Data() : Data(bytes: sqlite3_column_blob(stmt, i), count: n)
                        row.append(["$b": d.b64] as [String: Any])
                    default: row.append(NSNull())
                    }
                }
                rows.append(row)
                rc = sqlite3_step(stmt)
            }
            guard rc == SQLITE_DONE else { throw failure(db, rc) }
            return ["columns": columns, "rows": rows] as [String: Any]
        default:
            throw NativeFailure("unknown native method \(method)")
        }
    }
}
